import { PRODUCTS } from '../data/SubAccountLedger.js';
import type { Member } from '../data/members.js';
import { dataRow, formRow, grid, heading, select, spanRow, submit, textInput } from '../html/legacy.js';
import { messageHtml, type MessageKey } from './messages.js';
import { contentScreen } from './shell.js';

/** The values re-rendered into the Open Sub-Account form after a validation message. */
export interface OpenSubAccountValues {
	readonly product?: string;
	readonly initialDeposit?: string;
	readonly nickname?: string;
}

/**
 * Open Sub-Account. The member id travels in the form action's query string, so the form's only inputs are
 * `txtAmt`, `txtNick` (in that order) and the Continue button.
 */
export function openSubAccountScreen(
	member: Member,
	options: { message?: MessageKey; values?: OpenSubAccountValues } = {},
): string {
	const values = options.values ?? {};
	const form = `<form method="post" action="/subaccount/confirm?m=${encodeURIComponent(member.id)}">
${grid(
	[
		spanRow(heading('Open Sub-Account')),
		spanRow(messageHtml(options.message)),
		dataRow('Member Name', member.name),
		formRow('Product', select('selProd', PRODUCTS, values.product)),
		formRow('Initial Deposit', textInput('txtAmt', { value: values.initialDeposit ?? '', size: 12 })),
		formRow('Nickname', textInput('txtNick', { value: values.nickname ?? '', size: 30 })),
		spanRow(submit('btnCont', 'Continue')),
	],
	{ width: '500' },
)}
</form>`;
	return contentScreen('Open Sub-Account', form);
}
