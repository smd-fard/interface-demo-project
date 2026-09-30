import type { Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { browserInternals } from '../../src/playwright/BrowserHandle.js';
import {
	commandCaptureScript,
	installCaptureScript,
	passCaptureScript,
	type CaptureCommand,
	type CaptureConfig,
	type PassKind,
} from '../../src/recorder/captureScript.js';
import type { DomEventDescriptor } from '../../src/recorder/DomEventDescriptor.js';
import { launchBrowserFixture, type BrowserFixture } from '../../src/testing/index.js';

const PAGE = `<!doctype html><html><body>
<form id="f" onsubmit="window.__submits = (window.__submits || 0) + 1; return false;">
  <input id="field" name="q" value="">
  <button id="go" type="submit">Go</button>
</form>
</body></html>`;

const config: CaptureConfig = {
	binding: '__testRecord_b1',
	stateKey: '__idpCapture_test',
	secret: 'secret-one',
	previousSecret: null,
	enabled: true,
	tokenAttribute: 'data-idp-rec',
};

async function until(condition: () => boolean, what: string, timeoutMs = 5_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

describe('surface: capture script pass (one event, secret-checked)', () => {
	let browser: BrowserFixture;
	let page: Page;
	let reports: DomEventDescriptor[];

	const submits = () => page.evaluate(() => (window as unknown as { __submits?: number }).__submits ?? 0);
	const command = (cmd: CaptureCommand, secret = config.secret) =>
		page.evaluate(commandCaptureScript, { stateKey: config.stateKey, secret, command: cmd });
	const pass = (selector: string, kind: PassKind, secret = config.secret) =>
		page
			.locator(selector)
			.evaluate(passCaptureScript, { stateKey: config.stateKey, secret, command: { op: 'pass' as const, kind } });

	beforeAll(async () => {
		browser = await launchBrowserFixture();
	});
	beforeEach(async () => {
		const session = await browser.newSession({ origin: 'http://127.0.0.1:9' });
		page = browserInternals(session.handle).page;
		reports = [];
		await page.exposeBinding(config.binding, (_source, descriptor: DomEventDescriptor) => {
			reports.push(descriptor);
		});
		await page.setContent(PAGE);
		await page.evaluate(installCaptureScript, config);
	});
	afterEach(async () => {
		await browser.closeSessions();
	});
	afterAll(async () => {
		await browser?.close();
	});

	it('a fill pass does not let a later Enter in that field through: it is blocked and reported', async () => {
		expect(await pass('#field', 'change')).toBe(true);
		await page.locator('#field').focus();
		await page.keyboard.type('777');
		await page.keyboard.press('Enter');
		await until(() => reports.some((report) => report.event === 'keydown'), 'the reported Enter');
		expect(await submits()).toBe(0);
	});

	it('a click pass lets exactly one click (and its submit) through; the next click is blocked', async () => {
		expect(await pass('#go', 'click')).toBe(true);
		await page.locator('#go').click();
		await settle();
		expect(await submits()).toBe(1);
		expect(reports).toHaveLength(0);
		await page.locator('#go').click();
		await until(() => reports.length >= 1, 'the reported click');
		expect(reports[0]).toMatchObject({ event: 'click', tag: 'button' });
		expect(await submits()).toBe(1);
	});

	it('a press pass lets one Enter submit the form once; the next Enter is blocked', async () => {
		expect(await pass('#field', 'keydown')).toBe(true);
		await page.locator('#field').press('Enter');
		await settle();
		expect(await submits()).toBe(1);
		expect(reports).toHaveLength(0);
		await page.locator('#field').press('Enter');
		await until(() => reports.some((report) => report.event === 'keydown'), 'the reported Enter');
		expect(await submits()).toBe(1);
	});

	it('a pass on a field does not exempt its form: clicking the submit button is still blocked', async () => {
		expect(await pass('#field', 'keydown')).toBe(true);
		await page.locator('#go').click();
		await until(() => reports.length >= 1, 'the reported click');
		expect(reports[0]).toMatchObject({ event: 'click' });
		expect(await submits()).toBe(0);
	});

	it('page script cannot use a pass (untrusted click), set one, or switch mediation off', async () => {
		expect(await pass('#go', 'click')).toBe(true);
		// An untrusted (script) click does not consume the pass and is blocked.
		await page.evaluate(() => {
			for (const el of document.querySelectorAll('input, button, form')) el.setAttribute('data-idp-pass', '');
			document.getElementById('go')?.click();
		});
		await until(() => reports.length >= 1, 'the blocked script click');
		expect(await submits()).toBe(0);
		// Without the secret the control refuses every command; the property cannot be replaced.
		expect(await command({ op: 'disable' }, 'guess')).toBe(false);
		expect(await pass('#field', 'keydown', 'guess')).toBe(false);
		const replaced = await page.evaluate((key) => {
			const host = window as unknown as Record<string, unknown>;
			const before = host[key];
			try {
				host[key] = null;
			} catch (error) {
				void error;
			}
			return { same: host[key] === before, enumerable: Object.keys(window).includes(key) };
		}, config.stateKey);
		expect(replaced).toEqual({ same: true, enumerable: false });
		// The recorder's own trusted click still goes through once.
		await page.locator('#go').click();
		await settle();
		expect(await submits()).toBe(1);
	});

	it('clear drops a pass that was not used', async () => {
		expect(await pass('#go', 'click')).toBe(true);
		expect(await command({ op: 'clear' })).toBe(true);
		await page.locator('#go').click();
		await until(() => reports.length >= 1, 'the blocked click');
		expect(await submits()).toBe(0);
	});

	it('a new recording re-keys the document: the old secret no longer works', async () => {
		await page.evaluate(installCaptureScript, { ...config, secret: 'secret-two', previousSecret: config.secret });
		expect(await command({ op: 'clear' }, config.secret)).toBe(false);
		expect(await command({ op: 'clear' }, 'secret-two')).toBe(true);
	});
});
