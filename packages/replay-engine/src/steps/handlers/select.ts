import type { StepOf } from '@idp/artifact-schema';
import { actionBase, performAction } from '../performAction.js';
import type { StepContext, StepPosition } from '../StepContext.js';
import type { StepOutcome } from '../StepOutcome.js';
import { verifyCheckpoint } from '../verifyCheckpoint.js';

/** Chooses a bound option (param or literal) in the target dropdown, then verifies the step checkpoint. */
export async function runSelect(
	step: StepOf<'select'>,
	position: StepPosition,
	context: StepContext,
): Promise<StepOutcome> {
	const option = await context.binder.value(step.option);
	await performAction(
		step,
		position,
		{ kind: 'select', ...actionBase(step, context), target: { kind: 'target', target: step.target }, option },
		context,
	);
	return verifyCheckpoint(step.checkpoint, position, context);
}
