import { createRedactor, resolvePolicy } from '@idp/policy';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { markSensitiveElements } from '../../src/evidence/markSensitiveElements.js';
import { browserInternals } from '../../src/playwright/BrowserHandle.js';
import { ApprovalGrantRegistry, DialogPendingError, PolicyGuardedSurface, type ActionTarget } from '../../src/index.js';
import {
	launchBrowserFixture,
	launchMockBank,
	mockBankPolicyConfig,
	type BrowserFixture,
	type MockBank,
} from '../../src/testing/index.js';

const content = [{ kind: 'by_name' as const, name: 'content' }];
const rationale = 'functional test';
const actor = 'replay' as const;
const formRow = (labelText: string): ActionTarget => ({
	kind: 'target',
	target: {
		description: labelText,
		frame: content,
		ladder: [{ kind: 'structural', anchor: { kind: 'form_row', labelText, control: 'input' }, rationale }],
	},
});
const button = (name: string): ActionTarget => ({
	kind: 'target',
	target: {
		description: name,
		frame: content,
		ladder: [{ kind: 'role', role: 'button', name, exact: true, rationale }],
	},
});

const SENSITIVE = ['Jane Sample', '12345', '***-**-3456', '8800123450', '8800123451', '1523.47', '842.10'];

describe('surface: masked evidence capture', () => {
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

	async function memberDetail(options: { expectInquiry?: boolean } = {}) {
		const session = await browser.newSession({ origin: bank.origin });
		const surface = new PolicyGuardedSurface({
			inner: session.surface,
			policy: resolvePolicy(mockBankPolicyConfig(bank.origin)),
			origin: bank.origin,
			grants: new ApprovalGrantRegistry({ clock: { now: () => new Date() } }),
		});
		await surface.act({ kind: 'navigate', actor, route: '/' });
		await surface.act({ kind: 'fill', actor, target: formRow('User ID'), value: 'teller01', sensitive: true });
		await surface.act({
			kind: 'fill',
			actor,
			target: formRow('Password'),
			value: 'synthetic-pass-01',
			sensitive: true,
		});
		await surface.act({ kind: 'click', actor, target: button('Sign On') });
		await surface.act({ kind: 'fill', actor, target: formRow('Member #'), value: '12345', sensitive: true });
		await surface.act({ kind: 'click', actor, target: button('Search') });
		if (options.expectInquiry === false) return { surface, page: browserInternals(session.handle).page };
		expect(await surface.check({ kind: 'text_present', text: 'Member Inquiry', frame: content }, {}, 10_000)).toEqual({
			kind: 'held',
		});
		return { surface, page: browserInternals(session.handle).page };
	}

	const redactor = () => createRedactor({ sensitiveValues: ['12345', 'Jane Sample'] });

	it('marks the name, member number, SSN and the balance rows in the content frame', async () => {
		const { page } = await memberDetail();
		const marks = await markSensitiveElements(page, redactor());
		expect(marks.masks.length).toBeGreaterThan(0);
		// Member #, name, SSN, and the value cells of the Account / Share Savings / Checking / Member Name rows.
		expect(marks.count).toBeGreaterThanOrEqual(8);
		const content = page.frame({ name: 'content' });
		const maskedTexts = await content?.evaluate(() =>
			[...document.querySelectorAll('[data-idp-mask]')].map((element) => (element as HTMLElement).innerText.trim()),
		);
		for (const value of SENSITIVE) expect(maskedTexts?.some((text) => text.includes(value))).toBe(true);
		await marks.clear();
		expect(await content?.evaluate(() => document.querySelectorAll('[data-idp-mask]').length)).toBe(0);
	});

	it('captureEvidence: the screenshot differs from an unmasked one; the a11y tree and URL carry no sensitive value', async () => {
		const { surface, page } = await memberDetail();
		const unmasked = new Uint8Array(await page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' }));
		const evidence = await surface.captureEvidence(redactor());

		expect(evidence.screenshot.byteLength).toBeGreaterThan(1000);
		expect(Buffer.from(evidence.screenshot).equals(Buffer.from(unmasked))).toBe(false);
		// The masks are gone afterwards: a second unmasked shot matches the first.
		const again = new Uint8Array(await page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' }));
		expect(Buffer.from(again).equals(Buffer.from(unmasked))).toBe(true);

		const tree = JSON.stringify(evidence.a11yTree);
		expect(tree).toContain('Member Inquiry');
		for (const value of ['Jane Sample', '12345', '8800123450', '8800123451']) {
			expect(tree).not.toContain(value);
		}
		expect(evidence.url).not.toContain('12345');
	});

	it('refuses to capture while a native dialog blocks the page', async () => {
		await bank.setFault('known_dialog');
		// The known_dialog fault raises an alert on member detail; the guarded click reports it and leaves it pending.
		const { surface } = await memberDetail({ expectInquiry: false });
		expect(surface.pendingDialog()?.type).toBe('alert');
		await expect(surface.captureEvidence(redactor())).rejects.toBeInstanceOf(DialogPendingError);
	});
});
