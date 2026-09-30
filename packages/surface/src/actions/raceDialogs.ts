import type { DialogMonitor } from '../dialogs/DialogMonitor.js';
import type { PendingDialog } from '../port/PendingDialog.js';

/** Decides about a dialog that opened during the work: `true` = handled (keep waiting), `false` = leave it pending. */
export type DialogHandler = (dialog: PendingDialog) => Promise<boolean>;

/**
 * Runs browser work while watching for native dialogs. A dialog blocks the page's script, so work whose
 * handler opens one (an inline `confirm`, an `alert` while a page loads) would not finish until the dialog is
 * settled: the race returns promptly instead. Resolves `null` when the work finished, or the dialog left
 * pending (the unfinished work is then abandoned; its eventual result is ignored). Work errors propagate.
 */
export async function raceDialogs(
	monitor: Pick<DialogMonitor, 'next'>,
	start: () => Promise<void>,
	onDialog?: DialogHandler,
): Promise<PendingDialog | null> {
	let waiter = monitor.next();
	const work = (async () => start())();
	for (;;) {
		const winner = await Promise.race([
			work.then(() => ({ kind: 'done' as const })),
			waiter.promise.then((dialog) => ({ kind: 'dialog' as const, dialog })),
		]);
		waiter.cancel();
		if (winner.kind === 'done') return null;
		if (onDialog !== undefined && (await onDialog(winner.dialog))) {
			waiter = monitor.next();
			continue;
		}
		// Abandoned: the work settles once the dialog is handled; its outcome no longer matters.
		work.catch(() => undefined);
		return winner.dialog;
	}
}
