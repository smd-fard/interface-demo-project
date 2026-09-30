import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startMockBank, type RunningMockBank } from './harness/startMockBank.js';
import { cellRightOf, Teller, textOf, titleOf } from './harness/Teller.js';

const OPEN_FORM = { selProd: 'Holiday Club', txtAmt: '250.00', txtNick: 'Winter fund', btnCont: 'Continue' };

describe('mock-bank: open sub-account → review → opened', () => {
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

	it('renders the Open Sub-Account form: Product select, Initial Deposit before Nickname, Continue', async () => {
		const page = await teller.get('/subaccount/open?m=12345');
		expect(titleOf(page.body)).toBe('CoreOne - Open Sub-Account');
		expect(page.body).toMatch(/<td[^>]*>Product<\/td>\s*<td[^>]*><select name="selProd">/);
		expect(page.body).toContain('<option>Holiday Club</option>');
		expect(page.body).toContain('<option>Vacation Savings</option>');
		expect(page.body).toMatch(/<td[^>]*>Initial Deposit<\/td>\s*<td[^>]*><input type="text" name="txtAmt"/);
		expect(page.body).toMatch(/<td[^>]*>Nickname<\/td>\s*<td[^>]*><input type="text" name="txtNick"/);
		expect(page.body.indexOf('txtAmt')).toBeLessThan(page.body.indexOf('txtNick'));
		expect(page.body).toMatch(/<input type="submit" name="btnCont" value="Continue">/);
		// No hidden inputs: the only inputs of the form are txtAmt, txtNick and the button (nth_in_container rungs).
		const form = /<form[\s\S]*?<\/form>/.exec(page.body)?.[0] ?? '';
		expect(form).toContain('Initial Deposit');
		expect(form.match(/<input/g)?.length).toBe(3);
		expect(page.body).not.toMatch(/\sid=|data-testid|aria-|role=|<label/i);
	});

	it('walks Continue → Review (native confirm on Confirm) → Opened with SA-000001, then SA-000002', async () => {
		const review = await teller.post('/subaccount/confirm?m=12345', OPEN_FORM);
		expect(titleOf(review.body)).toBe('CoreOne - Confirm Sub-Account');
		expect(textOf(review.body)).toContain('Review Sub-Account');
		expect(textOf(review.body)).toContain('Holiday Club');
		expect(review.body).toContain(
			`<input type="submit" name="btnConfirm" value="Confirm" onclick="return window.confirm('This action cannot be undone. Continue?')">`,
		);
		expect(review.body).toMatch(/<form method="post" action="\/subaccount\/opened"/);

		const opened = await teller.post('/subaccount/opened', { btnConfirm: 'Confirm' });
		expect(titleOf(opened.body)).toBe('CoreOne - Sub-Account Opened');
		expect(textOf(opened.body)).toContain('Sub-Account Opened');
		expect(cellRightOf(opened.body, 'Confirmation #')).toBe('SA-000001');

		await teller.post('/subaccount/confirm?m=12346', { ...OPEN_FORM, selProd: 'Vacation Savings' });
		const second = await teller.post('/subaccount/opened', { btnConfirm: 'Confirm' });
		expect(cellRightOf(second.body, 'Confirmation #')).toBe('SA-000002');
	});

	it('does not commit twice: a second Confirm without a pending request goes back to Member Search', async () => {
		await teller.post('/subaccount/confirm?m=12345', OPEN_FORM);
		await teller.post('/subaccount/opened', { btnConfirm: 'Confirm' });
		const again = await teller.post('/subaccount/opened', { btnConfirm: 'Confirm' });
		expect(titleOf(again.body)).toBe('CoreOne - Member Search');
		expect(textOf(again.body)).toContain('No pending sub-account request');
	});

	it('re-renders the form with a red message for an invalid deposit or missing nickname', async () => {
		const badAmount = await teller.post('/subaccount/confirm?m=12345', { ...OPEN_FORM, txtAmt: 'ten' });
		expect(titleOf(badAmount.body)).toBe('CoreOne - Open Sub-Account');
		expect(badAmount.body).toContain('<font color="red">Invalid Initial Deposit</font>');
		const noNick = await teller.post('/subaccount/confirm?m=12345', { ...OPEN_FORM, txtNick: '' });
		expect(noNick.body).toContain('<font color="red">Nickname is required</font>');
	});

	it('resets the confirmation sequence on POST /__admin/reset', async () => {
		await teller.post('/subaccount/confirm?m=12345', OPEN_FORM);
		await teller.post('/subaccount/opened', { btnConfirm: 'Confirm' });
		await bank.reset();
		const fresh = new Teller(bank.url);
		await fresh.signOn();
		await fresh.post('/subaccount/confirm?m=12345', OPEN_FORM);
		const opened = await fresh.post('/subaccount/opened', { btnConfirm: 'Confirm' });
		expect(cellRightOf(opened.body, 'Confirmation #')).toBe('SA-000001');
	});

	it('denies the sub-account function to a teller without the entitlement (SEC-403)', async () => {
		const clerk = new Teller(bank.url);
		await clerk.signOn('teller02', 'synthetic-pass-02');
		const page = await clerk.get('/subaccount/open?m=12345');
		expect(textOf(page.body)).toContain('You are not authorized for this function (SEC-403)');
		expect(textOf((await clerk.get('/member/detail?m=12345')).body)).toContain('Member Inquiry');
	});
});
