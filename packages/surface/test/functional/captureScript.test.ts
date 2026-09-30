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
  <select id="product" onchange="window.__changes = (window.__changes || 0) + 1;">
    <option value="s">Savings</option><option value="v">Vacation Savings</option><option value="h">Holiday Club</option>
  </select>
  <button id="go" type="submit">Go</button>
</form>
</body></html>`;

const config: CaptureConfig = {
	binding: '__testRecord_b1',
	stateKey: '__idpCapture_test',
	secret: 'secret-one',
	previousSecret: null,
	mode: 'record',
	automation: false,
	blockMessage: 'Automation is in control',
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
	const changes = () => page.evaluate(() => (window as unknown as { __changes?: number }).__changes ?? 0);
	const valueOf = (selector: string) => page.locator(selector).inputValue();
	const configure = (overrides: Partial<CaptureConfig>) =>
		page.evaluate(installCaptureScript, { ...config, ...overrides });
	const banner = () => page.locator('#idp-refusal-banner').count();
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

	it("record: a person's select is stopped before the page's onchange and reported; settle(refused) reverts it", async () => {
		await page.locator('#product').focus();
		await page.keyboard.press('h');
		await until(() => reports.some((report) => report.event === 'change'), 'the reported select');
		expect(reports.find((report) => report.event === 'change')).toMatchObject({
			tag: 'select',
			optionLabel: 'Holiday Club',
		});
		expect(await changes()).toBe(0);
		expect(await valueOf('#product')).toBe('h');
		const settled = await page.locator('#product').evaluate(passCaptureScript, {
			stateKey: config.stateKey,
			secret: config.secret,
			command: { op: 'settle' as const, accepted: false },
		});
		expect(settled).toBe(true);
		expect(await valueOf('#product')).toBe('s');
		expect(await changes()).toBe(0);
	});

	it("record: the guard's re-executed select (passed change) reaches the page's onchange exactly once", async () => {
		await page.locator('#product').focus();
		await page.keyboard.press('v');
		await until(() => reports.some((report) => report.event === 'change'), 'the reported select');
		expect(await pass('#product', 'change')).toBe(true);
		await page.locator('#product').selectOption('v');
		await settle();
		expect(await changes()).toBe(1);
	});

	it('record: settle(refused) puts a typed field back to its value on focus', async () => {
		await page.locator('#field').fill('before');
		await page.locator('#go').focus();
		await page.locator('#field').focus();
		await page.keyboard.type('-typed');
		await page.keyboard.press('Tab');
		await until(() => reports.some((report) => report.event === 'change'), 'the reported fill');
		const settled = await page.locator('#field').evaluate(passCaptureScript, {
			stateKey: config.stateKey,
			secret: config.secret,
			command: { op: 'settle' as const, accepted: false },
		});
		expect(settled).toBe(true);
		expect(await valueOf('#field')).toBe('before');
	});

	it('block: every trusted gesture (click, typing, select, Enter) is blocked with a banner, and nothing is reported', async () => {
		await configure({ mode: 'block', secret: 'secret-two', previousSecret: config.secret });
		await page.mouse.click(1, 1); // focus the page, not a control
		const box = await page.locator('#go').boundingBox();
		if (box === null) throw new Error('the button is not visible');
		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
		const field = await page.locator('#field').boundingBox();
		if (field === null) throw new Error('the field is not visible');
		await page.mouse.click(field.x + 5, field.y + 5);
		await page.keyboard.type('999');
		await page.keyboard.press('Enter');
		const select = await page.locator('#product').boundingBox();
		if (select === null) throw new Error('the select is not visible');
		await page.mouse.click(select.x + 5, select.y + 5);
		await page.keyboard.press('h');
		await settle();
		expect(await submits()).toBe(0);
		expect(await changes()).toBe(0);
		expect(await valueOf('#field')).toBe('');
		expect(await valueOf('#product')).toBe('s');
		expect(await banner()).toBe(1);
		expect(await page.locator('#idp-refusal-banner').textContent()).toBe('Automation is in control');
		expect(reports).toHaveLength(0);
	});

	it('block: page script (untrusted events) is not blocked; with automation on, trusted input goes through', async () => {
		await configure({ mode: 'block', secret: 'secret-two', previousSecret: config.secret });
		await page.evaluate(() => (document.getElementById('f') as HTMLFormElement).requestSubmit());
		expect(await submits()).toBe(1);
		await configure({ mode: 'block', secret: 'secret-two', automation: true });
		await page.locator('#field').fill('4242');
		await page.locator('#product').selectOption('v');
		await page.locator('#go').click();
		await settle();
		expect(await valueOf('#field')).toBe('4242');
		expect(await changes()).toBe(1);
		expect(await submits()).toBe(2);
		expect(await banner()).toBe(0);
		await configure({ mode: 'block', secret: 'secret-two', automation: false });
		await page.locator('#go').click();
		await settle();
		expect(await submits()).toBe(2);
		expect(reports).toHaveLength(0);
	});

	it('block → off: the script goes inert', async () => {
		await configure({ mode: 'block', secret: 'secret-two', previousSecret: config.secret });
		await configure({ mode: 'off', secret: 'secret-two' });
		await page.locator('#go').click();
		await settle();
		expect(await submits()).toBe(1);
	});
});
