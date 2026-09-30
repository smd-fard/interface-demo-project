import { resolveRoute } from '../../internal/resolveRoute.js';
import { substituteTemplate } from '../../internal/substituteTemplate.js';
import type { ActOutcome } from '../../port/ActOutcome.js';
import type { SurfaceActionOf } from '../../port/SurfaceAction.js';
import type { ActionContext } from '../ActionContext.js';
import { actAndSettle } from '../actAndSettle.js';

/** Opens a route relative to the surface origin (placeholders bound first) and waits for every frame to load. */
export async function executeNavigate(
	context: ActionContext,
	action: SurfaceActionOf<'navigate'>,
): Promise<ActOutcome> {
	const url = resolveRoute(context.origin, substituteTemplate(action.route, action.bindings ?? {}));
	return actAndSettle(context, action, async () => {
		await context.page.goto(url, {
			waitUntil: 'commit',
			...(action.timeoutMs === undefined ? {} : { timeout: action.timeoutMs }),
		});
	});
}
