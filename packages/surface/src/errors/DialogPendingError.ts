import type { PendingDialog } from '../port/PendingDialog.js';

/**
 * An action was attempted while a native dialog is open. The page's script is blocked until the dialog is
 * settled (`dismiss_dialog`, or the approval path), so the action fails fast instead of hanging.
 */
export class DialogPendingError extends Error {
	readonly code = 'DIALOG_PENDING' as const;

	constructor(
		/** The action kind that was refused. */
		readonly actionKind: string,
		/** The dialog's type only: its message may carry app data (redact before any sink). */
		readonly dialogType: PendingDialog['type'],
	) {
		super(`cannot ${actionKind}: a native ${dialogType} dialog is pending; settle it first`);
		this.name = 'DialogPendingError';
	}
}
