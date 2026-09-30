import { ActionFailedError } from '../errors/ActionFailedError.js';
import type { ActOutcome } from '../port/ActOutcome.js';
import type { SurfaceAction } from '../port/SurfaceAction.js';
import type { ActionContext } from './ActionContext.js';
import { executeClick } from './executors/click.js';
import { executeDismissDialog } from './executors/dismissDialog.js';
import { executeExtract } from './executors/extract.js';
import { executeFill } from './executors/fill.js';
import { executeNavigate } from './executors/navigate.js';
import { executePress } from './executors/press.js';
import { executeSelect } from './executors/select.js';
import { executeWait } from './executors/wait.js';

function dispatch(context: ActionContext, action: SurfaceAction): Promise<ActOutcome> {
	switch (action.kind) {
		case 'navigate':
			return executeNavigate(context, action);
		case 'click':
			return executeClick(context, action);
		case 'fill':
			return executeFill(context, action);
		case 'select':
			return executeSelect(context, action);
		case 'press':
			return executePress(context, action);
		case 'extract':
			return executeExtract(context, action);
		case 'wait':
			return executeWait(context, action);
		case 'dismiss_dialog':
			return executeDismissDialog(context, action);
		default: {
			const unhandled: never = action;
			throw new Error(`unhandled action kind ${(unhandled as SurfaceAction).kind}`);
		}
	}
}

/** Our typed errors carry a stable string `code`; anything else came from the browser. */
function isTyped(error: unknown): boolean {
	return error instanceof Error && typeof (error as { code?: unknown }).code === 'string';
}

/**
 * Performs one action: refuses it with `DialogPendingError` while a native dialog is open (except
 * `dismiss_dialog`, which settles it), then dispatches to the kind's executor. Typed surface errors pass
 * through; browser errors are wrapped in `ActionFailedError` (no selector or value in the message).
 * Policy is not applied here: the guarded surface does it before calling `act` (invariant 2).
 */
export async function executeAction(context: ActionContext, action: SurfaceAction): Promise<ActOutcome> {
	if (action.kind !== 'dismiss_dialog') context.dialogs.assertNone(action.kind);
	try {
		return await dispatch(context, action);
	} catch (error) {
		if (isTyped(error)) throw error;
		const reason = error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'error';
		throw new ActionFailedError(action.kind, reason, { cause: error });
	}
}
