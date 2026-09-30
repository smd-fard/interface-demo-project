import { formRow, grid, heading, spanRow, submit, textInput } from '../html/legacy.js';
import type { Tenant } from '../tenants/tenants.js';
import { messageHtml, type MessageKey } from './messages.js';
import { contentScreen } from './shell.js';

/** Default delay of the `late_render` fault: the Search button appears this long after the page loaded. */
export const LATE_RENDER_DEFAULT_MS = 1500;

/**
 * The legacy "render it later" script of the `late_render` fault: after `delayMs` it writes the Search button
 * into the last cell of the search form (no ids: the form is `document.forms[0]`), as a slow client-side
 * widget of a legacy screen would.
 */
function lateButtonScript(button: string, delayMs: number): string {
	return `setTimeout(function () {
	var cells = document.forms[0].getElementsByTagName('td');
	cells[cells.length - 1].innerHTML = ${JSON.stringify(button)};
}, ${delayMs});`;
}

/**
 * Member Search. The member-number label is the tenant's (`Member #` / `Account holder ID`); the button is
 * `btnGo` with the tenant's caption. `withoutButton` renders the `control_missing` fault; `lateButtonMs`
 * renders the `late_render` fault (the button is injected by an inline script that many ms after load).
 */
export function memberSearchScreen(
	tenant: Tenant,
	options: { message?: MessageKey; value?: string; withoutButton?: boolean; lateButtonMs?: number } = {},
): string {
	const real = submit('btnGo', tenant.labels.searchButton);
	const late = options.lateButtonMs;
	const button = options.withoutButton || late !== undefined ? '&nbsp;' : real;
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
	return contentScreen('Member Search', form, late === undefined ? undefined : lateButtonScript(real, late));
}
