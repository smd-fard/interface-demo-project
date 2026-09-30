import type { StepOf } from '@idp/artifact-schema';
import { actionBase, performAction } from '../performAction.js';
import type { StepContext, StepPosition } from '../StepContext.js';
import type { StepOutcome } from '../StepOutcome.js';
import { verifyCheckpoint } from '../verifyCheckpoint.js';

/** Clicks the target through the guarded surface, then verifies the step checkpoint. */
export async function runClick(
	step: StepOf<'click'>,
	position: StepPosition,
	context: StepContext,
): Promise<StepOutcome> {
	const { landing } = await performAction(
		step,
		position,
		{ kind: 'click', ...actionBase(step, context), target: { kind: 'target', target: step.target } },
		context,
	);
	return verifyCheckpoint(step.checkpoint, position, context, landing);
}
