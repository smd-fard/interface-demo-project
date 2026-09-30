import { WaitTimeoutError } from '../../errors/WaitTimeoutError.js';
import type { ActOutcome } from '../../port/ActOutcome.js';
import type { SurfaceActionOf } from '../../port/SurfaceAction.js';
import type { ActionContext } from '../ActionContext.js';
import { buildOutcome } from '../actAndSettle.js';

/** Polls the checkpoint until it holds; throws `WaitTimeoutError` (with what was observed) when it never does. */
export async function executeWait(context: ActionContext, action: SurfaceActionOf<'wait'>): Promise<ActOutcome> {
	const loadsBefore = context.navigation.loadCount();
	const result = await context.check(action.until, action.bindings ?? {}, action.timeoutMs);
	if (result.kind === 'not_held') throw new WaitTimeoutError(action.timeoutMs, result.observed);
	return buildOutcome(context, action, loadsBefore);
}
