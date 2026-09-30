import type { Dialog } from 'playwright';
import { DialogPendingError } from '../errors/DialogPendingError.js';
import type { PendingDialog } from '../port/PendingDialog.js';

/** The part of a Playwright page the monitor needs (a fake in unit tests). */
export interface DialogSource {
	on(event: 'dialog', listener: (dialog: Dialog) => void): unknown;
}

/** A subscription to the next dialog: `promise` resolves when one is (or already is) pending. */
export interface DialogWaiter {
	readonly promise: Promise<PendingDialog>;
	cancel(): void;
}

function describe(dialog: Dialog): PendingDialog {
	return { type: dialog.type() as PendingDialog['type'], message: dialog.message() };
}

/**
 * Holds native dialogs as pending instead of letting Playwright auto-dismiss them, so a run can see them in
 * the observation and settle them deliberately (`dismiss_dialog`, or the approval path of an irreversible
 * click). Never auto-accepts. Executors race their browser work against `next()`: a dialog blocks the page's
 * script, so an action whose handler opens one would otherwise hang.
 */
export class DialogMonitor {
	private pending: Dialog | null = null;
	private readonly waiters = new Set<(dialog: PendingDialog) => void>();

	constructor(page: DialogSource) {
		page.on('dialog', (dialog) => {
			this.pending = dialog;
			const info = describe(dialog);
			for (const notify of [...this.waiters]) notify(info);
		});
	}

	current(): PendingDialog | null {
		return this.pending === null ? null : describe(this.pending);
	}

	/** Throws `DialogPendingError` when a dialog is open (every action but `dismiss_dialog` calls this first). */
	assertNone(actionKind: string): void {
		const dialog = this.current();
		if (dialog !== null) throw new DialogPendingError(actionKind, dialog.type);
	}

	/** Resolves with the pending dialog now, or with the next one to open. */
	next(): DialogWaiter {
		let notify: ((dialog: PendingDialog) => void) | undefined;
		const promise = new Promise<PendingDialog>((resolve) => {
			const open = this.current();
			if (open !== null) {
				resolve(open);
				return;
			}
			notify = (dialog) => {
				if (notify !== undefined) this.waiters.delete(notify);
				resolve(dialog);
			};
			this.waiters.add(notify);
		});
		return {
			promise,
			cancel: () => {
				if (notify !== undefined) this.waiters.delete(notify);
			},
		};
	}

	/** Accepts or dismisses the pending dialog; returns false when none was open. */
	async settle(action: 'accept' | 'dismiss', promptText?: string): Promise<boolean> {
		const dialog = this.pending;
		if (dialog === null) return false;
		this.pending = null;
		if (action === 'accept') await dialog.accept(promptText);
		else await dialog.dismiss();
		return true;
	}
}
