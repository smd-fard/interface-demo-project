import type { StepOf } from '@idp/artifact-schema';
import { actionBase, performAction } from '../performAction.js';
import type { StepContext, StepPosition } from '../StepContext.js';
import type { StepOutcome } from '../StepOutcome.js';
import { verifyCheckpoint } from '../verifyCheckpoint.js';

/**
 * Waits, bounded by the step's own `timeoutMs`, until its condition holds (the surface throws
 * `WaitTimeoutError` → `checkpoint_failed`), then verifies the step checkpoint if it has one.
 */
export async function runWait(
	step: StepOf<'wait'>,
	position: StepPosition,
	context: StepContext,
): Promise<StepOutcome> {
	await performAction(
		step,
		position,
		{ kind: 'wait', ...actionBase(step, context), until: step.until, timeoutMs: step.timeoutMs },
		context,
	);
	return verifyCheckpoint(step.checkpoint, position, context);
}
