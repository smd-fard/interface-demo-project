import type { PendingSubAccount } from '../data/SubAccountLedger.js';
import type { Member } from '../data/members.js';
import { dataRow, grid, heading, link, spanRow, submit } from '../html/legacy.js';
import type { Tenant } from '../tenants/tenants.js';
import { contentScreen } from './shell.js';

/** The native confirm the irreversible Confirm button raises. */
export const CONFIRM_DIALOG_TEXT = 'This action cannot be undone. Continue?';

/** Review Sub-Account: the pending request and the irreversible Confirm (inline `window.confirm`). */
export function confirmSubAccountScreen(tenant: Tenant, member: Member, pending: PendingSubAccount): string {
	const form = `<form method="post" action="/subaccount/opened">
${grid(
	[
		spanRow(heading('Review Sub-Account')),
		dataRow(tenant.labels.memberNumber, member.id),
		dataRow('Member Name', member.name),
		dataRow('Product', pending.product),
		dataRow('Initial Deposit', pending.initialDeposit),
		dataRow('Nickname', pending.nickname),
		spanRow(
			`${submit('btnConfirm', 'Confirm', `return window.confirm('${CONFIRM_DIALOG_TEXT}')`)}&nbsp;&nbsp;${link(`/member/detail?m=${encodeURIComponent(member.id)}`, 'Cancel')}`,
		),
	],
	{ width: '500', border: 0 },
)}
</form>`;
	return contentScreen('Confirm Sub-Account', form);
}
