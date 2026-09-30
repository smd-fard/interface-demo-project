import { readFileSync } from 'node:fs';
import { CapabilityArtifactSchema, type TargetRef } from '@idp/artifact-schema';
import { resolvePolicy } from '@idp/policy';
import type { Page } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { browserInternals } from '../../src/playwright/BrowserHandle.js';
import {
	ApprovalGrantRegistry,
	HumanActionRecorder,
	PolicyGuardedSurface,
	type ActionTarget,
	type RecordedHumanAction,
} from '../../src/index.js';
import {
	launchBrowserFixture,
	launchMockBank,
	mockBankPolicyConfig,
	SimulatedOperator,
	type BrowserFixture,
	type MockBank,
} from '../../src/testing/index.js';

const content = [{ kind: 'by_name' as const, name: 'content' }];
const rationale = 'functional test';
const actor = 'replay' as const;

function fixtureTargets(name: string): (id: string) => TargetRef {
	const fixture = CapabilityArtifactSchema.parse(
		JSON.parse(readFileSync(new URL(`../../../artifact-schema/fixtures/${name}`, import.meta.url), 'utf8')),
	);
	return (id) => {
		const step = fixture.steps.find((candidate) => candidate.id === id);
		if (step === undefined || !('target' in step) || step.target === undefined) throw new Error(id);
		return step.target;
	};
}
const lookup = fixtureTargets('member-lookup.artifact.json');
const subAccount = fixtureTargets('open-sub-account.artifact.json');
const t = (target: TargetRef): ActionTarget => ({ kind: 'target', target });

const memberInput: TargetRef = {
	description: 'Member # input',
	frame: content,
	ladder: [{ kind: 'structural', anchor: { kind: 'form_row', labelText: 'Member #', control: 'input' }, rationale }],
};
const searchButton: TargetRef = {
	description: 'Search button',
	frame: content,
	ladder: [{ kind: 'role', role: 'button', name: 'Search', exact: true, rationale }],
};
const confirmButton: TargetRef = {
	description: 'Confirm button',
	frame: content,
	ladder: [{ kind: 'role', role: 'button', name: 'Confirm', exact: true, rationale }],
};

async function until(condition: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

const textIn = (text: string) => ({ kind: 'text_present' as const, text, frame: content });

interface Handoff {
	readonly guard: PolicyGuardedSurface;
	readonly operator: SimulatedOperator;
	readonly recorder: HumanActionRecorder;
	readonly records: RecordedHumanAction[];
	readonly page: Page;
	/** Requests the page made whose URL contains the given path. */
	readonly requests: (path: string) => number;
}

describe('surface: human-action recorder (mediated control)', () => {
	let bank: MockBank;
	let browser: BrowserFixture;
	const recorders: HumanActionRecorder[] = [];

	beforeAll(async () => {
		bank = await launchMockBank({ tenant: 'a' });
		browser = await launchBrowserFixture();
	});
	afterEach(async () => {
		await Promise.all(recorders.splice(0).map((recorder) => recorder.stop()));
		await browser.closeSessions();
		await bank.clearFaults();
		await bank.reset();
	});
	afterAll(async () => {
		await browser?.close();
		await bank?.stop();
	});

	/** Signs on through the guard (replay), then hands the session to a simulated human under the recorder. */
	async function handoff(prepare?: (guard: PolicyGuardedSurface) => Promise<void>): Promise<Handoff> {
		const session = await browser.newSession({ origin: bank.origin });
		const guard = new PolicyGuardedSurface({
			inner: session.surface,
			policy: resolvePolicy(mockBankPolicyConfig(bank.origin)),
			origin: bank.origin,
			grants: new ApprovalGrantRegistry({ clock: { now: () => new Date() } }),
		});
		await guard.act({ kind: 'navigate', actor, route: '/' });
		await guard.act({ kind: 'fill', actor, target: t(lookup('s02-fill-user-id')), value: 'teller01', sensitive: true });
		await guard.act({
			kind: 'fill',
			actor,
			target: t(lookup('s03-fill-password')),
			value: 'synthetic-pass-01',
			sensitive: true,
		});
		await guard.act({ kind: 'click', actor, target: t(lookup('s04-click-sign-on')) });
		expect(await guard.check(textIn('Member Search'), {}, 10_000)).toEqual({ kind: 'held' });
		await prepare?.(guard);

		const page = browserInternals(session.handle).page;
		const urls: string[] = [];
		page.on('request', (request) => urls.push(request.url()));
		const recorder = new HumanActionRecorder(session.handle);
		recorders.push(recorder);
		const records: RecordedHumanAction[] = [];
		await recorder.start(guard, (record) => records.push(record));
		return {
			guard,
			operator: new SimulatedOperator(session.handle),
			recorder,
			records,
			page,
			requests: (path) => urls.filter((url) => url.includes(path)).length,
		};
	}

	it('fill + click Search: recorded with ladder-ready fingerprints, executed exactly once through the guard', async () => {
		const { guard, operator, records, requests } = await handoff();
		await operator.type(memberInput, '12345');
		await operator.click(searchButton);
		await until(() => records.length >= 2, 'two recorded actions');
		expect(await guard.check(textIn('Member Inquiry'), {}, 10_000)).toEqual({ kind: 'held' });

		expect(records[0]).toMatchObject({
			seq: 1,
			kind: 'fill',
			value: '12345',
			sensitive: true,
			verdict: 'allow',
			refused: false,
			fingerprint: { labelCellText: 'Member #', tag: 'input', framePath: ['content'] },
		});
		expect(records[1]).toMatchObject({
			seq: 2,
			kind: 'click',
			sensitive: false,
			verdict: 'allow',
			refused: false,
			fingerprint: { role: 'button', name: 'Search', framePath: ['content'] },
		});
		expect(typeof records[1]?.at).toBe('string');
		// One search submitted: the human's click was blocked, the guarded re-execution submitted once.
		expect(requests('/member/detail')).toBe(1);
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(records).toHaveLength(2);
	});

	it('Enter in the member field: recorded as fill + press, one search submitted', async () => {
		const { guard, operator, records, requests } = await handoff();
		await operator.type(memberInput, '24680');
		await operator.press('Enter');
		await until(() => records.length >= 2, 'fill and press');
		expect(await guard.check(textIn('Ada Fixture'), {}, 10_000)).toEqual({ kind: 'held' });
		expect(records.map((record) => [record.kind, record.value, record.refused])).toEqual([
			['fill', '24680', false],
			['press', 'Enter', false],
		]);
		expect(requests('/member/detail')).toBe(1);
	});

	it('a link to another origin is refused before acting, not followed, and a banner shows', async () => {
		const { guard, operator, records, page, requests } = await handoff();
		const contentFrame = page.frame({ name: 'content' });
		await contentFrame?.evaluate(() => {
			const link = document.createElement('a');
			link.href = 'http://blocked.invalid/steal';
			link.textContent = 'Elsewhere';
			document.body.appendChild(link);
		});
		const before = contentFrame?.url();
		await operator.click({ text: 'Elsewhere', frame: content });
		await until(() => records.length >= 1, 'the refused click');
		expect(records[0]).toMatchObject({
			kind: 'click',
			verdict: 'deny',
			denyCode: 'origin_not_allowed',
			refused: true,
			fingerprint: { role: 'link', name: 'Elsewhere' },
		});
		expect(requests('blocked.invalid')).toBe(0);
		expect(page.frame({ name: 'content' })?.url()).toBe(before);
		expect(await guard.check(textIn('Member Search'), {}, 0)).toEqual({ kind: 'held' });
		expect(await guard.check(textIn('Refused by policy'), {}, 2_000)).toEqual({ kind: 'held' });
	});

	it('Confirm clicked by a human without a grant is refused (require_approval); no dialog, still on Review', async () => {
		const { guard, operator, records, requests } = await handoff(async (surface) => {
			await surface.act({ kind: 'fill', actor, target: t(memberInput), value: '12345', sensitive: true });
			await surface.act({ kind: 'click', actor, target: t(searchButton) });
			await surface.act({ kind: 'click', actor, target: t(subAccount('s07-click-open-sub-account')) });
			await surface.act({
				kind: 'select',
				actor,
				target: t(subAccount('s08-select-product')),
				option: 'Vacation Savings',
			});
			await surface.act({
				kind: 'fill',
				actor,
				target: t(subAccount('s09-fill-initial-deposit')),
				value: '25.00',
				sensitive: false,
			});
			await surface.act({
				kind: 'fill',
				actor,
				target: t(subAccount('s10-fill-nickname')),
				value: 'Beach fund',
				sensitive: true,
			});
			await surface.act({ kind: 'click', actor, target: t(subAccount('s11-click-continue')) });
			expect(await surface.check(textIn('Review Sub-Account'), {}, 10_000)).toEqual({ kind: 'held' });
		});
		await operator.click(confirmButton);
		await until(() => records.length >= 1, 'the refused Confirm');
		expect(records[0]).toMatchObject({ kind: 'click', verdict: 'require_approval', refused: true });
		expect(guard.pendingDialog()).toBeNull();
		expect(requests('/subaccount/opened')).toBe(0);
		expect(await guard.check(textIn('Review Sub-Account'), {}, 0)).toEqual({ kind: 'held' });
	});

	it('a native dialog raised by an allowed click is settled by the operator as a recorded dismiss_dialog', async () => {
		await bank.setFault('known_dialog');
		const { guard, operator, recorder, records } = await handoff();
		await operator.type(memberInput, '12345');
		await operator.click(searchButton);
		await until(() => records.length >= 2, 'fill and click');
		await until(() => guard.pendingDialog() !== null, 'the alert');
		const settled = await recorder.settleDialog('accept');
		expect(settled).toMatchObject({ kind: 'dismiss_dialog', value: 'accept', verdict: 'allow', refused: false });
		expect(records.at(-1)).toEqual(settled);
		expect(guard.pendingDialog()).toBeNull();
	});

	it('typing an off-allowlist URL in the address bar is blocked and recorded as a refused navigate', async () => {
		const { operator, records } = await handoff();
		await expect(operator.open('http://blocked.invalid/')).rejects.toThrow();
		await until(() => records.length >= 1, 'the refused navigate');
		expect(records[0]).toMatchObject({
			kind: 'navigate',
			fingerprint: null,
			value: 'http://blocked.invalid',
			verdict: 'deny',
			refused: true,
		});
	});

	it('a page script cannot bypass mediation: a data-idp-pass attribute or the window state does not exempt a gesture', async () => {
		const { guard, operator, records, page, requests } = await handoff();
		const tampered = await page.frame({ name: 'content' })?.evaluate(() => {
			for (const el of document.querySelectorAll('input, button, form')) el.setAttribute('data-idp-pass', '');
			let touched = 0;
			const host = window as unknown as Record<string, unknown>;
			for (const key of Object.getOwnPropertyNames(window)) {
				if (!key.startsWith('__idpCapture')) continue;
				touched += 1;
				try {
					host[key] = null;
				} catch (error) {
					void error;
				}
				try {
					(host[key] as (...args: unknown[]) => unknown)('guess', { op: 'disable' });
				} catch (error) {
					void error;
				}
			}
			return touched;
		});
		expect(tampered).toBe(1);
		await operator.type(memberInput, '12345');
		await operator.click(searchButton);
		await until(() => records.length >= 2, 'fill and click');
		expect(await guard.check(textIn('Member Inquiry'), {}, 10_000)).toEqual({ kind: 'held' });
		expect(records.map((record) => [record.kind, record.verdict, record.refused])).toEqual([
			['fill', 'allow', false],
			['click', 'allow', false],
		]);
		// Intercepted and re-executed once through the guard, not passed through as well.
		expect(requests('/member/detail')).toBe(1);
	});

	it('after an allowed fill, Enter in that field is still intercepted and recorded as press (one submit)', async () => {
		const { guard, operator, records, requests } = await handoff();
		await operator.type(memberInput, '24680');
		await operator.press('Tab');
		await until(() => records.length >= 1, 'the fill');
		expect(records[0]).toMatchObject({ kind: 'fill', verdict: 'allow', refused: false });
		await operator.click(memberInput);
		await operator.press('Enter');
		await until(() => records.length >= 2, 'the press');
		expect(await guard.check(textIn('Ada Fixture'), {}, 10_000)).toEqual({ kind: 'held' });
		expect(records[1]).toMatchObject({ kind: 'press', value: 'Enter', verdict: 'allow', refused: false });
		expect(requests('/member/detail')).toBe(1);
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(records).toHaveLength(2);
		expect(requests('/member/detail')).toBe(1);
	});

	it('an excluded same-origin route typed in the address bar is refused, never reached, and recorded', async () => {
		const { operator, records, page } = await handoff();
		const reached: string[] = [];
		page.on('response', (response) => reached.push(response.url()));
		const before = page.url();
		await expect(operator.open(`${bank.origin}/__admin/faults`)).rejects.toThrow();
		await until(() => records.length >= 1, 'the refused navigate');
		expect(records[0]).toMatchObject({
			kind: 'navigate',
			fingerprint: null,
			value: `${bank.origin}/__admin/faults`,
			sensitive: true,
			verdict: 'deny',
			denyCode: 'route_not_allowed',
			refused: true,
		});
		expect(reached.filter((url) => url.includes('/__admin'))).toHaveLength(0);
		expect(page.url()).toBe(before);
	});

	it('an irreversible route typed in the address bar needs approval: refused and recorded', async () => {
		const { operator, records, page } = await handoff();
		const reached: string[] = [];
		page.on('response', (response) => reached.push(response.url()));
		await expect(operator.open(`${bank.origin}/subaccount/opened`)).rejects.toThrow();
		await until(() => records.length >= 1, 'the refused navigate');
		expect(records[0]).toMatchObject({ kind: 'navigate', verdict: 'require_approval', refused: true });
		expect(reached.filter((url) => url.includes('/subaccount/opened'))).toHaveLength(0);
	});

	it('an allowed same-origin navigation is recorded once as an allowed navigate (its frames are not)', async () => {
		const { guard, operator, records } = await handoff();
		await operator.open(`${bank.origin}/`);
		await until(() => records.length >= 1, 'the navigate');
		expect(await guard.check(textIn('Member Search'), {}, 10_000)).toEqual({ kind: 'held' });
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			kind: 'navigate',
			fingerprint: null,
			value: `${bank.origin}/`,
			sensitive: true,
			verdict: 'allow',
			refused: false,
		});
	});

	it('after stop the capture script is inert: gestures are neither blocked nor recorded', async () => {
		const { guard, operator, recorder, records, requests } = await handoff();
		await recorder.stop();
		await operator.type(memberInput, '12345');
		await operator.click(searchButton);
		expect(await guard.check(textIn('Member Inquiry'), {}, 10_000)).toEqual({ kind: 'held' });
		expect(records).toHaveLength(0);
		expect(requests('/member/detail')).toBe(1);
	});
});
