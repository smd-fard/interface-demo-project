import { formRow, grid, heading, spanRow, submit, textInput } from '../html/legacy.js';
import type { Tenant } from '../tenants/tenants.js';
import { messageHtml, type MessageKey } from './messages.js';
import { contentScreen } from './shell.js';

/**
 * Member Search. The member-number label is the tenant's (`Member #` / `Account holder ID`); the button is
 * `btnGo` with the tenant's caption. `withoutButton` renders the `control_missing` fault.
 */
export function memberSearchScreen(
	tenant: Tenant,
	options: { message?: MessageKey; value?: string; withoutButton?: boolean } = {},
): string {
	const button = options.withoutButton ? '&nbsp;' : submit('btnGo', tenant.labels.searchButton);
	const form = `<form method="get" action="/member/detail">
${grid(
	[
		spanRow(heading('Member Search')),
		spanRow(messageHtml(options.message)),
		formRow(tenant.labels.memberNumber, textInput('txt1', { value: options.value ?? '', size: 10 })),
		spanRow(button),
	],
	{ width: '400' },
)}
</form>`;
	return contentScreen('Member Search', form);
}
