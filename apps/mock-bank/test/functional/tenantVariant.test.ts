import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMockBank, type RunningMockBank } from './harness/startMockBank.js';
import { cellRightOf, Teller, textOf, titleOf } from './harness/Teller.js';

describe('mock-bank: tenant B variant', () => {
	let tenantA: RunningMockBank;
	let tenantB: RunningMockBank;

	beforeAll(async () => {
		tenantA = await startMockBank({ MOCKBANK_TENANT: 'a' });
		tenantB = await startMockBank({ MOCKBANK_TENANT: 'b' });
	});
	afterAll(async () => {
		await Promise.all([tenantA.stop(), tenantB.stop()]);
	});

	it('reports a different version string and branding', async () => {
		const teller = new Teller(tenantB.url);
		expect(titleOf((await teller.get('/')).body)).toBe('CoreOne 7.2');
		const bannerA = textOf((await new Teller(tenantA.url).get('/banner')).body);
		const bannerB = textOf((await teller.get('/banner')).body);
		expect(bannerB).toContain('CoreOne 7.2');
		expect(bannerB).not.toEqual(bannerA.replace('7.4', '7.2'));
	});

	it('reorders the menu', async () => {
		const menuOf = async (bank: RunningMockBank): Promise<string[]> => {
			const nav = (await new Teller(bank.url).get('/nav')).body;
			return [...nav.matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((m) => m[1] ?? '');
		};
		const menuA = await menuOf(tenantA);
		const menuB = await menuOf(tenantB);
		expect([...menuB].sort()).toEqual([...menuA].sort());
		expect(menuB).not.toEqual(menuA);
	});

	it('relabels Member # as "Account holder ID" and Search as "Find"; titles and texts stay the same', async () => {
		const teller = new Teller(tenantB.url);
		await teller.signOn();
		const search = await teller.get('/member/search');
		expect(titleOf(search.body)).toBe('CoreOne - Member Search');
		expect(textOf(search.body)).toContain('Member Search');
		expect(search.body).toMatch(/<td[^>]*>Account holder ID<\/td>\s*<td[^>]*><input type="text" name="txt1"/);
		expect(search.body).toMatch(/<input type="submit" name="btnGo" value="Find">/);
		expect(search.body).not.toContain('Member #');
		expect(search.body).not.toMatch(/value="Search"/);
	});

	it('runs the same lookup and sub-account flow with tenant-B labels', async () => {
		const teller = new Teller(tenantB.url);
		await teller.signOn();
		const detail = await teller.get('/member/detail?txt1=12345&btnGo=Find');
		expect(titleOf(detail.body)).toBe('CoreOne - Member Inquiry');
		expect(cellRightOf(detail.body, 'Share Savings')).toBe('1523.47');
		expect(cellRightOf(detail.body, 'Member Name')).toBe('Jane Sample');

		const missing = await teller.get('/member/detail?txt1=99999&btnGo=Find');
		expect(missing.body).toContain('No records match your search criteria');
		expect(missing.body).toContain('Account holder ID');

		await teller.post('/subaccount/confirm?m=12345', {
			selProd: 'Vacation Savings',
			txtAmt: '10.00',
			txtNick: 'Trip',
			btnCont: 'Continue',
		});
		const opened = await teller.post('/subaccount/opened', { btnConfirm: 'Confirm' });
		expect(cellRightOf(opened.body, 'Confirmation #')).toBe('SA-000001');
	});
});
