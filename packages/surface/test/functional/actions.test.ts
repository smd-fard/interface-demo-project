import { readFileSync } from 'node:fs';
import { CapabilityArtifactSchema, type LocatorRung, type TargetRef } from '@idp/artifact-schema';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	DialogMismatchError,
	DialogPendingError,
	NoDialogPendingError,
	WaitTimeoutError,
	type ActionTarget,
	type ApprovalGrant,
	type Surface,
} from '../../src/index.js';
import { launchBrowserFixture, launchMockBank, type BrowserFixture, type MockBank } from '../../src/testing/index.js';

const content = [{ kind: 'by_name' as const, name: 'content' }];
const rationale = 'functional test';
const actor = 'replay' as const;
/** A dummy approval: the policy guard validates grants; the raw surface only honours presence. */
const grant: ApprovalGrant = {
	requestId: 'req-functional-test',
	stepId: 'functional-test',
	issuedAt: '2026-01-01T00:00:00.000Z',
	expiresAt: '2026-01-01T00:05:00.000Z',
	grantedBy: 'operator-test',
};

function fixtureTargets(name: string): (id: string) => ActionTarget {
	const fixture = CapabilityArtifactSchema.parse(
		JSON.parse(readFileSync(new URL(`../../../artifact-schema/fixtures/${name}`, import.meta.url), 'utf8')),
	);
	return (id) => {
		const step = fixture.steps.find((candidate) => candidate.id === id);
		if (step === undefined || !('target' in step) || step.target === undefined) throw new Error(id);
		return { kind: 'target', target: step.target };
	};
}
const lookup = fixtureTargets('member-lookup.artifact.json');
const subAccount = fixtureTargets('open-sub-account.artifact.json');

const formRow = (labelText: string, control: 'input' | 'select' = 'input'): LocatorRung => ({
	kind: 'structural',
	anchor: { kind: 'form_row', labelText, control },
	rationale,
});
const ladder = (description: string, rungs: LocatorRung[]): ActionTarget => ({
	kind: 'target',
	target: { description, frame: content, ladder: rungs } satisfies TargetRef,
});
const byRole = (role: 'button' | 'link', name: string): LocatorRung => ({
	kind: 'role',
	role,
	name,
	exact: true,
	rationale,
});

const userId = lookup('s02-fill-user-id');
const password = lookup('s03-fill-password');
const signOn = lookup('s04-click-sign-on');
const memberInput = lookup('s05-fill-member-id');
const searchButton = lookup('s06-click-search');
const savingsBalance = lookup('s07-extract-savings-balance');
const openSubAccount = subAccount('s07-click-open-sub-account');
const product = subAccount('s08-select-product');
const initialDeposit = subAccount('s09-fill-initial-deposit');
const nickname = subAccount('s10-fill-nickname');
const continueButton = subAccount('s11-click-continue');
const confirmButton = subAccount('s12-click-confirm');
const confirmationNumber = subAccount('s13-extract-confirmation-number');

const textIn = (text: string) => ({ kind: 'text_present' as const, text, frame: content });

describe('surface: action executors against mock-bank', () => {
	let bank: MockBank;
	let browser: BrowserFixture;

	beforeAll(async () => {
		bank = await launchMockBank({ tenant: 'a' });
		browser = await launchBrowserFixture();
	});
	afterEach(async () => {
		await browser.closeSessions();
		await bank.clearFaults();
		await bank.reset();
	});
	afterAll(async () => {
		await browser?.close();
		await bank?.stop();
	});

	async function expectText(surface: Surface, text: string): Promise<void> {
		expect(await surface.check(textIn(text), {}, 10_000)).toEqual({ kind: 'held' });
	}

	async function signedOn(): Promise<Surface> {
		const { surface } = await browser.newSession({ origin: bank.origin });
		await surface.act({ kind: 'navigate', actor, route: '/' });
		await expectText(surface, 'Sign On');
		await surface.act({ kind: 'fill', actor, target: userId, value: 'teller01', sensitive: true });
		await surface.act({ kind: 'fill', actor, target: password, value: 'synthetic-pass-01', sensitive: true });
		await surface.act({ kind: 'click', actor, target: signOn });
		await expectText(surface, 'Member Search');
		return surface;
	}

	async function memberDetail(): Promise<Surface> {
		const surface = await signedOn();
		await surface.act({ kind: 'fill', actor, target: memberInput, value: '12345', sensitive: true });
		await surface.act({ kind: 'click', actor, target: searchButton });
		await expectText(surface, 'Member Inquiry');
		return surface;
	}

	async function reviewSubAccount(): Promise<Surface> {
		const surface = await memberDetail();
		await surface.act({ kind: 'click', actor, target: openSubAccount });
		await expectText(surface, 'Initial Deposit');
		await surface.act({ kind: 'select', actor, target: product, option: 'Vacation Savings' });
		await surface.act({ kind: 'fill', actor, target: initialDeposit, value: '25.00', sensitive: false });
		await surface.act({ kind: 'fill', actor, target: nickname, value: 'Beach fund', sensitive: true });
		await surface.act({ kind: 'click', actor, target: continueButton });
		await expectText(surface, 'Review Sub-Account');
		return surface;
	}

	it('navigate: opens a route relative to the origin and waits for the frameset to load', async () => {
		const { surface } = await browser.newSession({ origin: bank.origin });
		const outcome = await surface.act({ kind: 'navigate', actor, route: '/' });
		expect(outcome).toMatchObject({ kind: 'navigate', url: `${bank.origin}/` });
		expect(outcome.navigation?.status).toBe(200);
		expect(outcome.dialog).toBeUndefined();
		// The content frame has loaded by the time act returns: no polling needed.
		expect(await surface.check(textIn('Sign On'), {}, 0)).toEqual({ kind: 'held' });
	});

	it('navigate: a route that leaves the origin is refused before the browser moves', async () => {
		const { surface } = await browser.newSession({ origin: bank.origin });
		await expect(surface.act({ kind: 'navigate', actor, route: '//blocked.invalid/' })).rejects.toMatchObject({
			code: 'NAVIGATION_BLOCKED',
		});
	});

	it('fill + click: signs on; the click reports the content-frame load and the resolving rung', async () => {
		const { surface } = await browser.newSession({ origin: bank.origin });
		await surface.act({ kind: 'navigate', actor, route: '/' });
		const filled = await surface.act({ kind: 'fill', actor, target: userId, value: 'teller01', sensitive: true });
		expect(filled).toMatchObject({
			kind: 'fill',
			navigation: null,
			resolution: { rungIndex: 0, rungKind: 'structural' },
		});
		await surface.act({ kind: 'fill', actor, target: password, value: 'synthetic-pass-01', sensitive: true });
		const clicked = await surface.act({ kind: 'click', actor, target: signOn });
		expect(clicked).toMatchObject({ kind: 'click', resolution: { rungIndex: 0, rungKind: 'role' } });
		expect(clicked.navigation).toMatchObject({ framePath: ['content'], status: 200 });
		expect(clicked.navigation?.url).toContain('/member/search');
		expect(await surface.check(textIn('Member Search'), {}, 0)).toEqual({ kind: 'held' });
	});

	it('fill + click by observation ref (the agent path)', async () => {
		const { surface } = await browser.newSession({ origin: bank.origin });
		await surface.act({ kind: 'navigate', actor: 'agent', route: '/' });
		const observation = await surface.observe();
		const flatten = (node: typeof observation.tree): (typeof observation.tree)[] => [
			node,
			...node.children.flatMap(flatten),
		];
		const nodes = flatten(observation.tree);
		const [user, pwd] = nodes.filter((node) => node.role === 'textbox');
		const button = nodes.find((node) => node.role === 'button' && node.name === 'Sign On');
		const ref = (node: (typeof nodes)[number] | undefined): ActionTarget => ({ kind: 'ref', ref: node?.ref ?? '?' });
		await surface.act({ kind: 'fill', actor: 'agent', target: ref(user), value: 'teller01', sensitive: true });
		await surface.act({ kind: 'fill', actor: 'agent', target: ref(pwd), value: 'synthetic-pass-01', sensitive: true });
		const clicked = await surface.act({ kind: 'click', actor: 'agent', target: ref(button) });
		expect(clicked.resolution).toBeUndefined();
		expect(await surface.check(textIn('Member Search'), {}, 0)).toEqual({ kind: 'held' });
	});

	it('fill member 12345 + click Search → Member Inquiry; extract the Share Savings balance', async () => {
		const surface = await memberDetail();
		const outcome = await surface.act({ kind: 'extract', actor, target: savingsBalance });
		expect(outcome).toMatchObject({ kind: 'extract', extracted: '1523.47', navigation: null });
	});

	it('select: chooses the Product by label; the review page shows it', async () => {
		const surface = await memberDetail();
		await surface.act({ kind: 'click', actor, target: openSubAccount });
		await expectText(surface, 'Initial Deposit');
		const selected = await surface.act({ kind: 'select', actor, target: product, option: 'Vacation Savings' });
		expect(selected).toMatchObject({ kind: 'select', resolution: { rungIndex: 0 } });
		expect((await surface.act({ kind: 'extract', actor, target: product })).extracted).toBe('Vacation Savings');
		await expect(
			surface.act({ kind: 'select', actor, target: product, option: 'No Such Product' }),
		).rejects.toMatchObject({ code: 'OPTION_NOT_FOUND' });
	});

	it('press: Enter on the member input submits the search; Tab without a target presses on the focus', async () => {
		const surface = await signedOn();
		await surface.act({ kind: 'fill', actor, target: memberInput, value: '12345', sensitive: true });
		const tabbed = await surface.act({ kind: 'press', actor, key: 'Tab' });
		expect(tabbed).toMatchObject({ kind: 'press', navigation: null });
		const pressed = await surface.act({ kind: 'press', actor, target: memberInput, key: 'Enter' });
		expect(pressed.navigation).toMatchObject({ framePath: ['content'], status: 200 });
		expect(await surface.check(textIn('Member Inquiry'), {}, 0)).toEqual({ kind: 'held' });
	});

	it('wait: holds once the text is present; times out with a typed error otherwise', async () => {
		const surface = await signedOn();
		const outcome = await surface.act({ kind: 'wait', actor, until: textIn('Member Search'), timeoutMs: 5_000 });
		expect(outcome.kind).toBe('wait');
		const error = await surface
			.act({ kind: 'wait', actor, until: textIn('Sub-Account Opened'), timeoutMs: 300 })
			.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(WaitTimeoutError);
		expect(error).toMatchObject({ code: 'WAIT_TIMEOUT', timeoutMs: 300 });
		expect((error as WaitTimeoutError).observed).toContain('Sub-Account Opened');
	});

	it('known_dialog: the click reports the pending alert; other actions fail fast; dismiss_dialog accepts it', async () => {
		await bank.setFault('known_dialog');
		const surface = await signedOn();
		await surface.act({ kind: 'fill', actor, target: memberInput, value: '12345', sensitive: true });
		const clicked = await surface.act({ kind: 'click', actor, target: searchButton });
		expect(clicked.dialog).toEqual({ type: 'alert', message: 'Scheduled maintenance tonight at 11 PM' });
		expect(surface.pendingDialog()).toEqual(clicked.dialog);
		expect((await surface.observe()).pendingDialog).toEqual(clicked.dialog);

		const pending = await surface.act({ kind: 'extract', actor, target: savingsBalance }).catch((e: unknown) => e);
		expect(pending).toBeInstanceOf(DialogPendingError);
		expect(pending).toMatchObject({ code: 'DIALOG_PENDING', dialogType: 'alert' });
		await expect(surface.act({ kind: 'navigate', actor, route: '/' })).rejects.toBeInstanceOf(DialogPendingError);

		const mismatch = await surface
			.act({ kind: 'dismiss_dialog', actor, match: 'Printer queue', action: 'accept' })
			.catch((e: unknown) => e);
		expect(mismatch).toBeInstanceOf(DialogMismatchError);
		expect(mismatch).toMatchObject({ code: 'DIALOG_MISMATCH' });
		expect(surface.pendingDialog()).not.toBeNull();

		const dismissed = await surface.act({
			kind: 'dismiss_dialog',
			actor,
			match: 'Scheduled   maintenance',
			action: 'accept',
		});
		expect(dismissed).toMatchObject({ kind: 'dismiss_dialog' });
		expect(dismissed.dialog).toBeUndefined();
		expect(surface.pendingDialog()).toBeNull();
		expect(await surface.check(textIn('Member Inquiry'), {}, 0)).toEqual({ kind: 'held' });
		expect((await surface.act({ kind: 'extract', actor, target: savingsBalance })).extracted).toBe('1523.47');

		await expect(
			surface.act({ kind: 'dismiss_dialog', actor, match: 'Scheduled maintenance', action: 'accept' }),
		).rejects.toBeInstanceOf(NoDialogPendingError);
	});

	it('Confirm without a grant: the confirm is left pending, never accepted; dismissing it stays on Review', async () => {
		const surface = await reviewSubAccount();
		expect(await surface.check(textIn('Vacation Savings'), {}, 0)).toEqual({ kind: 'held' });
		const clicked = await surface.act({ kind: 'click', actor, target: confirmButton });
		expect(clicked.dialog).toEqual({ type: 'confirm', message: 'This action cannot be undone. Continue?' });
		expect(clicked.acceptedDialog).toBeUndefined();
		expect(surface.pendingDialog()?.type).toBe('confirm');
		await expect(surface.act({ kind: 'click', actor, target: confirmButton })).rejects.toBeInstanceOf(
			DialogPendingError,
		);

		await surface.act({ kind: 'dismiss_dialog', actor, match: 'cannot be undone', action: 'dismiss' });
		expect(surface.pendingDialog()).toBeNull();
		expect(await surface.check(textIn('Review Sub-Account'), {}, 0)).toEqual({ kind: 'held' });
		expect(await surface.check(textIn('Sub-Account Opened'), {}, 0)).toMatchObject({ kind: 'not_held' });
	});

	it('Confirm with an approval grant: its own confirm is accepted and the run lands on Sub-Account Opened', async () => {
		const surface = await reviewSubAccount();
		const clicked = await surface.act({ kind: 'click', actor, target: confirmButton, approvalGrant: grant });
		expect(clicked.acceptedDialog).toEqual({ type: 'confirm', message: 'This action cannot be undone. Continue?' });
		expect(clicked.dialog).toBeUndefined();
		expect(clicked.navigation).toMatchObject({ framePath: ['content'], status: 200 });
		expect(surface.pendingDialog()).toBeNull();
		expect(await surface.check(textIn('Sub-Account Opened'), {}, 0)).toEqual({ kind: 'held' });
		const extracted = await surface.act({ kind: 'extract', actor, target: confirmationNumber });
		expect(extracted.extracted).toBe('SA-000001');
	});

	it('a grant does not accept a dialog the click did not raise (an alert on the landing page stays pending)', async () => {
		await bank.setFault('known_dialog');
		const surface = await signedOn();
		await surface.act({ kind: 'fill', actor, target: memberInput, value: '12345', sensitive: true });
		const clicked = await surface.act({ kind: 'click', actor, target: searchButton, approvalGrant: grant });
		expect(clicked.acceptedDialog).toBeUndefined();
		expect(clicked.dialog?.type).toBe('alert');
		expect(surface.pendingDialog()?.type).toBe('alert');
	});

	it('a hand-written ladder (form_row + role rungs) looks up another member', async () => {
		const surface = await signedOn();
		const input = ladder('Member # input', [formRow('Member #')]);
		const button = ladder('Search button', [byRole('button', 'Search')]);
		await surface.act({ kind: 'fill', actor, target: input, value: '24680', sensitive: true });
		await surface.act({ kind: 'click', actor, target: button });
		expect(await surface.check(textIn('Ada Fixture'), {}, 0)).toEqual({ kind: 'held' });
	});
});
