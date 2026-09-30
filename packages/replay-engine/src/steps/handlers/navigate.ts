import type { StepOf } from '@idp/artifact-schema';
import { actionBase, performAction } from '../performAction.js';
import type { StepContext, StepPosition } from '../StepContext.js';
import type { StepOutcome } from '../StepOutcome.js';
import { verifyCheckpoint } from '../verifyCheckpoint.js';

/** Loads a route (placeholders bound from the params; the guard checks the route and the landing), then verifies. */
export async function runNavigate(
	step: StepOf<'navigate'>,
	position: StepPosition,
	context: StepContext,
): Promise<StepOutcome> {
	const { landing } = await performAction(
		step,
		position,
		{ kind: 'navigate', ...actionBase(step, context), route: step.route },
		context,
	);
	return verifyCheckpoint(step.checkpoint, position, context, landing);
}
