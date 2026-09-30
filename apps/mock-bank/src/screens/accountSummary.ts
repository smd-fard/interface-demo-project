import { grid, heading, spanRow } from '../html/legacy.js';
import { contentScreen } from './shell.js';

/**
 * The `wrong_screen` fault: a plausible CoreOne screen that is not the one the flow expects (HTTP 200, no error
 * text, no message any condition rule matches) — e.g. a mis-routed search. It lets a checkpoint mismatch
 * (`checkpoint_failed`) be injected without editing an artifact.
 */
export function accountSummaryScreen(): string {
	return contentScreen(
		'Account Summary',
		grid([spanRow(heading('Account Summary')), spanRow('Select an account from the menu to continue.')], {
			width: '500',
		}),
	);
}
