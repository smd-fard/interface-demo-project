import type { StepOf } from '@idp/artifact-schema';
import { actionBase, performAction } from '../performAction.js';
import type { StepContext, StepPosition } from '../StepContext.js';
import type { StepOutcome } from '../StepOutcome.js';
import { verifyCheckpoint } from '../verifyCheckpoint.js';

/** Presses one allowlisted key (on the target, or the focused element), then verifies the step checkpoint. */
export async function runPress(
	step: StepOf<'press'>,
	position: StepPosition,
	context: StepContext,
): Promise<StepOutcome> {
	const { landing } = await performAction(
		step,
		position,
		{
			kind: 'press',
			...actionBase(step, context),
			key: step.key,
			...(step.target === undefined ? {} : { target: { kind: 'target', target: step.target } as const }),
		},
		context,
	);
	return verifyCheckpoint(step.checkpoint, position, context, landing);
}
