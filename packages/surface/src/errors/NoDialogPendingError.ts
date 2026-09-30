/** `dismiss_dialog` was attempted but no native dialog is open. */
export class NoDialogPendingError extends Error {
	readonly code = 'NO_DIALOG_PENDING' as const;

	constructor(
		/** The expected text (from the step or profile, never a runtime value). */
		readonly match: string,
	) {
		super(`no native dialog is pending (expected one containing "${match}")`);
		this.name = 'NoDialogPendingError';
	}
}
