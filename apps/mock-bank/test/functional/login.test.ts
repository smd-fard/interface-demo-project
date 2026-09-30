import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMockBank, type RunningMockBank } from './harness/startMockBank.js';
import { Teller, textOf, titleOf } from './harness/Teller.js';

describe('mock-bank: server, frameset and sign on', () => {
	let bank: RunningMockBank;

	beforeAll(async () => {
		bank = await startMockBank({ MOCKBANK_SESSION_IDLE_MS: '400' });
	});
	afterAll(async () => {
		await bank.stop();
	});

	it('answers the health check', async () => {
		const response = await fetch(bank.at('/__health'));
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('ok');
	});

	it('serves a three-frame frameset that loads Sign On into the content frame when signed out', async () => {
		const page = await new Teller(bank.url).get('/');
		expect(page.status).toBe(200);
		expect(titleOf(page.body)).toBe('CoreOne 7.4');
		expect(page.body).toMatch(/<frameset/i);
		expect(page.body).toMatch(/<frame[^>]+name="banner"[^>]+src="\/banner"/i);
		expect(page.body).toMatch(/<frame[^>]+name="nav"[^>]+src="\/nav"/i);
		expect(page.body).toMatch(/<frame[^>]+name="content"[^>]+src="\/login"/i);
	});

	it('renders banner and nav frames with the tenant branding and menu', async () => {
		const teller = new Teller(bank.url);
		expect(textOf((await teller.get('/banner')).body)).toContain('CoreOne 7.4');
		const nav = await teller.get('/nav');
		expect(nav.body).toMatch(/target="content"/);
		expect(textOf(nav.body)).toContain('Member Search');
	});

	it('renders the hostile Sign On form: adjacent-cell labels, generic names, no ids or ARIA', async () => {
		const page = await new Teller(bank.url).get('/login');
		expect(titleOf(page.body)).toBe('CoreOne - Sign On');
		const text = textOf(page.body);
		expect(text).toContain('Sign On');
		expect(page.body).toMatch(/<td[^>]*>User ID<\/td>\s*<td[^>]*><input type="text" name="txtUser"/);
		expect(page.body).toMatch(/<td[^>]*>Password<\/td>\s*<td[^>]*><input type="password" name="txtPwd"/);
		expect(page.body).toMatch(/<input type="submit" name="btnSignOn" value="Sign On">/);
		expect(page.body.indexOf('txtUser')).toBeLessThan(page.body.indexOf('txtPwd'));
		expect(page.body).not.toMatch(/\sid=|data-testid|aria-|role=|<label/i);
		// Layout tables nested three or more deep.
		expect(page.body.match(/<table/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
	});

	it('signs on with the synthetic seed credential and lands on Member Search', async () => {
		const teller = new Teller(bank.url);
		const signOn = await teller.post('/login', { txtUser: 'teller01', txtPwd: 'synthetic-pass-01' }, { follow: false });
		expect(signOn.status).toBe(303);
		expect(signOn.location).toBe('/member/search');
		const search = await teller.get('/member/search');
		expect(titleOf(search.body)).toBe('CoreOne - Member Search');
		const frameset = await teller.get('/');
		expect(frameset.body).toMatch(/<frame[^>]+name="content"[^>]+src="\/member\/search"/i);
	});

	it('rejects a bad password with a red message and stays on Sign On', async () => {
		const teller = new Teller(bank.url);
		const page = await teller.post('/login', { txtUser: 'teller01', txtPwd: 'wrong' });
		expect(page.status).toBe(200);
		expect(titleOf(page.body)).toBe('CoreOne - Sign On');
		expect(page.body).toContain('<font color="red">Invalid User ID or Password</font>');
		const guarded = await teller.get('/member/search');
		expect(titleOf(guarded.body)).toBe('CoreOne - Sign On');
	});

	it('redirects a signed-out request for a content page to Sign On', async () => {
		const page = await new Teller(bank.url).get('/member/search', { follow: false });
		expect(page.status).toBe(302);
		expect(page.location).toBe('/login');
	});

	it('expires an idle session and redirects to Sign On with "Your session has expired"', async () => {
		const teller = new Teller(bank.url);
		await teller.signOn();
		await new Promise((resolve) => setTimeout(resolve, 1_200));
		const redirect = await teller.get('/member/search', { follow: false });
		expect(redirect.status).toBe(302);
		expect(redirect.location).toBe('/login?reason=expired');
		const page = await teller.get(redirect.location ?? '');
		expect(titleOf(page.body)).toBe('CoreOne - Sign On');
		expect(textOf(page.body)).toContain('Your session has expired');
		// The expired session is gone: a further request is a plain signed-out redirect.
		expect((await teller.get('/member/search', { follow: false })).location).toBe('/login');
	});

	it('signs off from the nav menu', async () => {
		const teller = new Teller(bank.url);
		await teller.signOn();
		const page = await teller.get('/logout');
		expect(titleOf(page.body)).toBe('CoreOne - Sign On');
		expect(titleOf((await teller.get('/member/search')).body)).toBe('CoreOne - Sign On');
	});
});
