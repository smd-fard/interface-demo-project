import type { ActOutcome } from '../../port/ActOutcome.js';
import type { SurfaceActionOf } from '../../port/SurfaceAction.js';
import type { ActionContext } from '../ActionContext.js';
import { actAndSettle } from '../actAndSettle.js';

/** Replaces the target's content with the (already bound) value. The value is never logged or echoed. */
export async function executeFill(context: ActionContext, action: SurfaceActionOf<'fill'>): Promise<ActOutcome> {
	const resolved = await context.resolveTarget(action.target, action.bindings ?? {});
	return actAndSettle(
		context,
		action,
		async () => {
			await resolved.locator.fill(action.value, action.timeoutMs === undefined ? {} : { timeout: action.timeoutMs });
		},
		{ extras: () => (resolved.resolution === undefined ? {} : { resolution: resolved.resolution }) },
	);
}
