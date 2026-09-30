import { maskedSsn, type Member } from '../data/members.js';
import { dataRow, grid, heading, link, nest, spanRow } from '../html/legacy.js';
import type { Tenant } from '../tenants/tenants.js';
import { MESSAGES } from './messages.js';
import { contentScreen } from './shell.js';

/** The inline native dialog Member Inquiry may carry (faults `known_dialog` / `unknown_dialog`). */
export type DetailDialog = 'known' | 'unknown';

/**
 * Member Inquiry: member facts, then a nested balances table (row header | amount | account number) and
 * the Open Sub-Account link. `dialog` adds the inline native dialog of the `known_dialog` /
 * `unknown_dialog` faults.
 */
export function memberDetailScreen(tenant: Tenant, member: Member, dialog?: DetailDialog): string {
	const facts = grid(
		[
			dataRow(tenant.labels.memberNumber, member.id),
			dataRow('Member Name', member.name),
			dataRow('SSN', maskedSsn(member)),
			dataRow('Member Since', member.memberSince),
			dataRow('Branch', member.branch),
		],
		{ border: 1, width: '100%' },
	);
	const balances = grid(
		[
			'<tr><td bgcolor="#CCCCBB"><b>Account</b></td><td bgcolor="#CCCCBB"><b>Balance</b></td><td bgcolor="#CCCCBB"><b>Account Number</b></td></tr>',
			dataRow('Share Savings', member.shareSavings.balance, member.shareSavings.accountNumber),
			dataRow('Checking', member.checking.balance, member.checking.accountNumber),
		],
		{ border: 1, width: '100%' },
	);
	const inner = grid(
		[
			spanRow(heading('Member Inquiry')),
			spanRow(facts),
			spanRow('<font face="Arial" size="2"><b>Balances</b></font>'),
			spanRow(nest(balances, 2)),
			spanRow(link(`/subaccount/open?m=${encodeURIComponent(member.id)}`, 'Open Sub-Account')),
		],
		{ width: '600' },
	);
	return contentScreen('Member Inquiry', inner, dialogScript(dialog));
}

function dialogScript(dialog: DetailDialog | undefined): string | undefined {
	if (dialog === 'known') return `alert(${JSON.stringify(MESSAGES.knownDialog)});`;
	if (dialog === 'unknown')
		return `if (window.confirm(${JSON.stringify(MESSAGES.unknownDialog)})) { window.status = 'retry'; }`;
	return undefined;
}
