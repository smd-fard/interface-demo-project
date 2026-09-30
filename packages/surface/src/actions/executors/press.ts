import type { ActOutcome } from '../../port/ActOutcome.js';
import type { SurfaceActionOf } from '../../port/SurfaceAction.js';
import type { ActionContext } from '../ActionContext.js';
import { actAndSettle } from '../actAndSettle.js';

/** Presses a key on the target, or on the focused element when there is none, and waits for the frames to load. */
export async function executePress(context: ActionContext, action: SurfaceActionOf<'press'>): Promise<ActOutcome> {
	const resolved =
		action.target === undefined ? undefined : await context.resolveTarget(action.target, action.bindings ?? {});
	return actAndSettle(
		context,
		action,
		async () => {
			if (resolved === undefined) await context.page.keyboard.press(action.key);
			else
				await resolved.locator.press(action.key, action.timeoutMs === undefined ? {} : { timeout: action.timeoutMs });
		},
		{ extras: () => (resolved?.resolution === undefined ? {} : { resolution: resolved.resolution }) },
	);
}
