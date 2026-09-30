import type { StepOf } from '@idp/artifact-schema';
import { actionBase, performAction } from '../performAction.js';
import type { StepContext, StepPosition } from '../StepContext.js';
import type { StepOutcome } from '../StepOutcome.js';
import { verifyCheckpoint } from '../verifyCheckpoint.js';

/**
 * Types a bound value (param, literal or credential) into the target. A sensitive fill's value is added to the
 * redactor before the action, so no sink can see it; the action log never carries it.
 */
export async function runFill(
	step: StepOf<'fill'>,
	position: StepPosition,
	context: StepContext,
): Promise<StepOutcome> {
	const value = await context.binder.value(step.value);
	if (step.sensitive) context.redactor.addSensitiveValue(value);
	await performAction(
		step,
		position,
		{
			kind: 'fill',
			...actionBase(step, context),
			target: { kind: 'target', target: step.target },
			value,
			sensitive: step.sensitive,
		},
		context,
	);
	return verifyCheckpoint(step.checkpoint, position, context);
}
