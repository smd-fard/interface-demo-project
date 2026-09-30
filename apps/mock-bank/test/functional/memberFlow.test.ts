import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startMockBank, type RunningMockBank } from './harness/startMockBank.js';
import { cellRightOf, Teller, textOf, titleOf } from './harness/Teller.js';

describe('mock-bank: member search and member inquiry', () => {
	let bank: RunningMockBank;
	let teller: Teller;

	beforeAll(async () => {
		bank = await startMockBank();
	});
	afterAll(async () => {
		await bank.stop();
	});
	beforeEach(async () => {
		await bank.reset();
		teller = new Teller(bank.url);
		await teller.signOn();
	});

	it('renders Member Search with the "Member #" row and a Search button named btnGo', async () => {
		const page = await teller.get('/member/search');
		expect(titleOf(page.body)).toBe('CoreOne - Member Search');
		expect(textOf(page.body)).toContain('Member Search');
		expect(page.body).toMatch(/<td[^>]*>Member #<\/td>\s*<td[^>]*><input type="text" name="txt1"/);
		expect(page.body).toMatch(/<input type="submit" name="btnGo" value="Search">/);
		expect(page.body).toMatch(/<form method="get" action="\/member\/detail"/);
		expect(page.body).not.toMatch(/\sid=|data-testid|aria-|role=|<label/i);
	});

	it('shows Member Inquiry with name, balances, masked SSN, account numbers and the Open Sub-Account link', async () => {
		const page = await teller.get('/member/detail?txt1=12345&btnGo=Search');
		expect(page.status).toBe(200);
		expect(titleOf(page.body)).toBe('CoreOne - Member Inquiry');
		const text = textOf(page.body);
		expect(text).toContain('Member Inquiry');
		expect(cellRightOf(page.body, 'Member Name')).toBe('Jane Sample');
		expect(cellRightOf(page.body, 'Share Savings')).toBe('1523.47');
		expect(cellRightOf(page.body, 'Checking')).toBe('842.10');
		expect(text).toMatch(/\*\*\*-\*\*-\d{4}/);
		expect(text).toMatch(/\b\d{10}\b/);
		expect(page.body).toContain('<a href="/subaccount/open?m=12345">Open Sub-Account</a>');
		// The balances sit in a nested table: at least three layout tables deep.
		expect(page.body.match(/<table/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
	});

	it('accepts the m= form of the detail URL for every seeded member', async () => {
		for (const [id, name] of [
			['12345', 'Jane Sample'],
			['12346', 'John Placeholder'],
			['24680', 'Ada Fixture'],
		] as const) {
			const page = await teller.get(`/member/detail?m=${id}`);
			expect(cellRightOf(page.body, 'Member Name')).toBe(name);
		}
	});

	it('re-renders the search page with a red "No records match your search criteria" for an unknown member', async () => {
		const page = await teller.get('/member/detail?txt1=99999&btnGo=Search');
		expect(titleOf(page.body)).toBe('CoreOne - Member Search');
		expect(page.body).toContain('<font color="red">No records match your search criteria</font>');
		expect(page.body).toMatch(/name="txt1"/);
	});

	it('rejects non-digit or wrong-length input with "Invalid Member Number"', async () => {
		for (const bad of ['12a45', '1234', '123456', '']) {
			const page = await teller.get(`/member/detail?txt1=${encodeURIComponent(bad)}&btnGo=Search`);
			expect(titleOf(page.body)).toBe('CoreOne - Member Search');
			expect(page.body).toContain('<font color="red">Invalid Member Number</font>');
		}
	});

	it('requires a session for the member pages', async () => {
		const page = await new Teller(bank.url).get('/member/detail?m=12345');
		expect(titleOf(page.body)).toBe('CoreOne - Sign On');
	});
});
