import { dialogMatches } from '../../dialogs/dialogMatches.js';
import { DialogMismatchError } from '../../errors/DialogMismatchError.js';
import { NoDialogPendingError } from '../../errors/NoDialogPendingError.js';
import type { ActOutcome } from '../../port/ActOutcome.js';
import type { SurfaceActionOf } from '../../port/SurfaceAction.js';
import type { ActionContext } from '../ActionContext.js';
import { actAndSettle } from '../actAndSettle.js';

/**
 * Settles the pending native dialog (accept = OK, dismiss = Cancel) when its message contains `match`, then
 * waits for the frames the dialog was blocking to load. A dialog that does not match is left open.
 */
export async function executeDismissDialog(
	context: ActionContext,
	action: SurfaceActionOf<'dismiss_dialog'>,
): Promise<ActOutcome> {
	const dialog = context.dialogs.current();
	if (dialog === null) throw new NoDialogPendingError(action.match);
	if (!dialogMatches(dialog.message, action.match)) {
		throw new DialogMismatchError(action.match, dialog.type, dialog.message);
	}
	const loadsBefore = context.navigation.loadCount();
	await context.dialogs.settle(action.action);
	return actAndSettle(context, action, async () => undefined, { loadsBefore });
}
