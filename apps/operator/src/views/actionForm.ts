import { escapeHtml } from './escapeHtml.js';

/** The default operator handle offered in the handle field. */
export const DEFAULT_OPERATOR = 'ops-1';

/** One submit button of the action form: its label and the route it posts to. */
/** One button: its label and the console POST route it submits to. */
export interface FormAction {
	readonly label: string;
	readonly route: string;
}

/** The buttons of one action form, with the CSRF form token and the return path. */
export interface ActionFormInput {
	readonly actions: readonly FormAction[];
	/** The console's per-process form token (CSRF protection); checked on every POST. */
	readonly formToken: string;
	/** Where the server redirects after the action (a console path). */
	readonly returnTo: string;
	readonly operator?: string;
}

/**
 * The operator's action form: one handle field, the form token, and one button per allowed action, each
 * posting to its own route (`formaction`). Renders nothing when no action is allowed.
 */
export function actionForm(input: ActionFormInput): string {
	const [first] = input.actions;
	if (first === undefined) return '';
	const buttons = input.actions
		.map(
			(action) =>
				`<button type="submit" formaction="${escapeHtml(action.route)}" data-action="${escapeHtml(
					action.label.toLowerCase(),
				)}">${escapeHtml(action.label)}</button>`,
		)
		.join(' ');
	return [
		`<form class="actions" method="post" action="${escapeHtml(first.route)}">`,
		`<input type="hidden" name="formToken" value="${escapeHtml(input.formToken)}">`,
		`<input type="hidden" name="return" value="${escapeHtml(input.returnTo)}">`,
		`<label for="operator">Operator handle</label> `,
		`<input id="operator" name="operator" required pattern="[a-z0-9][a-z0-9._-]{0,63}" maxlength="64" autocomplete="off" value="${escapeHtml(
			input.operator ?? DEFAULT_OPERATOR,
		)}"> `,
		buttons,
		'</form>',
	].join('\n');
}
