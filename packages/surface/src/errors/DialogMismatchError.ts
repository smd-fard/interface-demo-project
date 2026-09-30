import type { PendingDialog } from '../port/PendingDialog.js';

/** `dismiss_dialog` found an open dialog whose message does not contain the expected text; it is left open. */
export class DialogMismatchError extends Error {
	readonly code = 'DIALOG_MISMATCH' as const;

	constructor(
		/** The expected text (from the step or profile, never a runtime value). */
		readonly match: string,
		readonly dialogType: PendingDialog['type'],
		/** The open dialog's message. Not in `message`: it may carry app data (redact before any sink). */
		readonly observedMessage: string,
	) {
		super(`the pending ${dialogType} dialog does not contain "${match}"; it was left open`);
		this.name = 'DialogMismatchError';
	}
}
