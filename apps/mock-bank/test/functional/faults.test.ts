import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startMockBank, type RunningMockBank } from './harness/startMockBank.js';
import { cellRightOf, Teller, textOf, titleOf } from './harness/Teller.js';

describe('mock-bank: fault switches', () => {
	let bank: RunningMockBank;
	let teller: Teller;

	beforeAll(async () => {
		bank = await startMockBank({ MOCKBANK_SLOW_MS: '300' });
	});
	afterAll(async () => {
		await bank.stop();
	});
	beforeEach(async () => {
		await bank.reset();
		teller = new Teller(bank.url);
		await teller.signOn();
	});

	it('member_not_found forces the search message on detail, once', async () => {
		await bank.setFault({ code: 'member_not_found' });
		const page = await teller.get('/member/detail?txt1=12345&btnGo=Search');
		expect(titleOf(page.body)).toBe('CoreOne - Member Search');
		expect(page.body).toContain('<font color="red">No records match your search criteria</font>');
		const next = await teller.get('/member/detail?txt1=12345&btnGo=Search');
		expect(titleOf(next.body)).toBe('CoreOne - Member Inquiry');
	});

	it('validation_error shows "Invalid Member Number" for a valid id', async () => {
		await bank.setFault({ code: 'validation_error' });
		const page = await teller.get('/member/detail?txt1=12345&btnGo=Search');
		expect(page.body).toContain('<font color="red">Invalid Member Number</font>');
	});

	it('permission_denied renders the SEC-403 denial on the member pages', async () => {
		await bank.setFault({ code: 'permission_denied' });
		const page = await teller.get('/member/detail?m=12345');
		expect(textOf(page.body)).toContain('You are not authorized for this function (SEC-403)');
	});

	it('known_dialog adds an inline alert with the maintenance notice to the detail page', async () => {
		await bank.setFault({ code: 'known_dialog' });
		const page = await teller.get('/member/detail?m=12345');
		expect(page.body).toContain('<script>alert("Scheduled maintenance tonight at 11 PM");</script>');
		expect(titleOf(page.body)).toBe('CoreOne - Member Inquiry');
		expect((await teller.get('/member/detail?m=12345')).body).not.toContain('alert(');
	});

	it('known_dialog in always mode raises the alert on every detail load', async () => {
		await bank.setFault({ code: 'known_dialog', mode: 'always' });
		expect((await teller.get('/member/detail?m=12345')).body).toContain('Scheduled maintenance');
		expect((await teller.get('/member/detail?m=12345')).body).toContain('Scheduled maintenance');
		await bank.clearFaults();
		expect((await teller.get('/member/detail?m=12345')).body).not.toContain('Scheduled maintenance');
	});

	it('unknown_dialog adds an inline confirm with unrecognised text to the detail page', async () => {
		await bank.setFault({ code: 'unknown_dialog' });
		const page = await teller.get('/member/detail?m=12345');
		expect(page.body).toContain('window.confirm("Printer queue PRN-07 is offline. Retry?")');
	});

	it('session_timeout expires the session on the next content request → Sign On with the expiry text', async () => {
		await bank.setFault({ code: 'session_timeout' });
		const page = await teller.get('/member/search');
		expect(page.url).toBe('/login?reason=expired');
		expect(titleOf(page.body)).toBe('CoreOne - Sign On');
		expect(textOf(page.body)).toContain('Your session has expired');
		await teller.signOn();
		expect(titleOf((await teller.get('/member/search')).body)).toBe('CoreOne - Member Search');
	});

	it('slow_load delays the next content page by MOCKBANK_SLOW_MS, or by delayMs', async () => {
		await bank.setFault({ code: 'slow_load' });
		let started = Date.now();
		await teller.get('/member/search');
		expect(Date.now() - started).toBeGreaterThanOrEqual(280);

		await bank.setFault({ code: 'slow_load', delayMs: 600 });
		started = Date.now();
		const page = await teller.get('/member/search');
		expect(Date.now() - started).toBeGreaterThanOrEqual(580);
		expect(titleOf(page.body)).toBe('CoreOne - Member Search');
	});

	it('failed_load returns a 503 page once', async () => {
		await bank.setFault({ code: 'failed_load' });
		const failed = await teller.get('/member/search');
		expect(failed.status).toBe(503);
		expect(titleOf(failed.body)).toBe('Service Unavailable');
		expect((await teller.get('/member/search')).status).toBe(200);
	});

	it('failed_load_persistent returns 503 on every content request until cleared', async () => {
		await bank.setFault({ code: 'failed_load_persistent' });
		expect((await teller.get('/member/search')).status).toBe(503);
		expect((await teller.get('/member/detail?m=12345')).status).toBe(503);
		await bank.clearFaults();
		expect((await teller.get('/member/search')).status).toBe(200);
	});

	it('app_error renders the legacy Runtime Error page titled "Server Error" with HTTP 500', async () => {
		await bank.setFault({ code: 'app_error' });
		const page = await teller.get('/member/detail?m=12345');
		expect(page.status).toBe(500);
		expect(titleOf(page.body)).toBe('Server Error');
		expect(textOf(page.body)).toContain('Runtime Error — ORA-06512');
	});

	it('control_missing removes the Search button from the search page', async () => {
		await bank.setFault({ code: 'control_missing' });
		const page = await teller.get('/member/search');
		expect(titleOf(page.body)).toBe('CoreOne - Member Search');
		expect(page.body).toMatch(/name="txt1"/);
		expect(page.body).not.toMatch(/value="Search"/);
		expect((await teller.get('/member/search')).body).toMatch(/value="Search"/);
	});

	it('late_render renders Search without the button and writes it in with a delayed inline script', async () => {
		await bank.setFault({ code: 'late_render', delayMs: 700 });
		const page = await teller.get('/member/search');
		expect(titleOf(page.body)).toBe('CoreOne - Member Search');
		expect(page.body).toMatch(/setTimeout\(function/);
		expect(page.body).toMatch(/}, 700\);/);
		// The button is not in the served markup: only the script's string literal holds it.
		expect(page.body.split('<script>')[0]).not.toMatch(/value="Search"/);
		expect((await teller.get('/member/search')).body).not.toMatch(/setTimeout/);
	});

	it('wrong_screen serves Account Summary instead of Member Inquiry, once', async () => {
		await bank.setFault({ code: 'wrong_screen' });
		const page = await teller.get('/member/detail?txt1=12345&btnGo=Search');
		expect(page.status).toBe(200);
		expect(titleOf(page.body)).toBe('CoreOne - Account Summary');
		expect(textOf(page.body)).not.toContain('Member Inquiry');
		expect(titleOf((await teller.get('/member/detail?txt1=12345&btnGo=Search')).body)).toBe('CoreOne - Member Inquiry');
	});

	it('honours an explicit route filter (glob) and leaves other routes alone', async () => {
		await bank.setFault({ code: 'app_error', route: '/subaccount/*' });
		expect((await teller.get('/member/detail?m=12345')).status).toBe(200);
		expect((await teller.get('/subaccount/open?m=12345')).status).toBe(500);
	});

	it('never fires on admin or health routes, and rejects an unknown code with 400', async () => {
		await bank.setFault({ code: 'failed_load_persistent' });
		expect((await fetch(bank.at('/__health'))).status).toBe(200);
		const bad = await fetch(bank.at('/__admin/faults'), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ code: 'meteor_strike' }),
		});
		expect(bad.status).toBe(400);
	});

	it('lists the armed faults on GET /__admin/faults', async () => {
		await bank.setFault({ code: 'known_dialog', mode: 'always' });
		const list = (await (await fetch(bank.at('/__admin/faults'))).json()) as { code: string; mode: string }[];
		expect(list).toEqual([expect.objectContaining({ code: 'known_dialog', mode: 'always' })]);
	});
});

describe('mock-bank: faults armed at start with MOCKBANK_FAULTS', () => {
	let bank: RunningMockBank;

	beforeAll(async () => {
		bank = await startMockBank({ MOCKBANK_FAULTS: 'app_error@/member/detail,known_dialog:always' });
	});
	afterAll(async () => {
		await bank.stop();
	});

	it('arms each listed fault with its mode and route, and re-arms them on reset', async () => {
		const teller = new Teller(bank.url);
		await teller.signOn();
		expect((await teller.get('/member/search')).status).toBe(200);
		expect(titleOf((await teller.get('/member/detail?m=12345')).body)).toBe('Server Error');
		const detail = await teller.get('/member/detail?m=12345');
		expect(cellRightOf(detail.body, 'Member Name')).toBe('Jane Sample');
		expect(detail.body).toContain('Scheduled maintenance');

		await bank.reset();
		const again = new Teller(bank.url);
		await again.signOn();
		expect(titleOf((await again.get('/member/detail?m=12345')).body)).toBe('Server Error');
	});
});
