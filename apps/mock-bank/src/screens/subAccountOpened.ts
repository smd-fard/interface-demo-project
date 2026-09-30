import type { OpenedSubAccount } from '../data/SubAccountLedger.js';
import { dataRow, grid, heading, link, spanRow } from '../html/legacy.js';
import type { Tenant } from '../tenants/tenants.js';
import { contentScreen } from './shell.js';

/** Sub-Account Opened: the confirmation number (`SA-nnnnnn`) and the new account's details. */
export function subAccountOpenedScreen(tenant: Tenant, opened: OpenedSubAccount): string {
	return contentScreen(
		'Sub-Account Opened',
		grid(
			[
				spanRow(heading('Sub-Account Opened')),
				dataRow('Confirmation #', opened.confirmationNumber),
				dataRow(tenant.labels.memberNumber, opened.memberId),
				dataRow('Product', opened.product),
				dataRow('Sub-Account Number', opened.accountNumber),
				dataRow('Initial Deposit', opened.initialDeposit),
				dataRow('Nickname', opened.nickname),
				spanRow(link('/member/search', 'Return to Member Search')),
			],
			{ width: '500' },
		),
	);
}
