import type { StepOf } from '@idp/artifact-schema';
import { actionBase, performAction } from '../performAction.js';
import type { StepContext, StepPosition } from '../StepContext.js';
import type { StepOutcome } from '../StepOutcome.js';
import { verifyCheckpoint } from '../verifyCheckpoint.js';

/**
 * Settles the expected native dialog (only one whose message contains `match`; any other is left open and fails
 * as `unknown_dialog`), then verifies the step checkpoint.
 */
export async function runDismissDialog(
	step: StepOf<'dismiss_dialog'>,
	position: StepPosition,
	context: StepContext,
): Promise<StepOutcome> {
	await performAction(
		step,
		position,
		{ kind: 'dismiss_dialog', ...actionBase(step, context), match: step.match, action: step.action },
		context,
	);
	return verifyCheckpoint(step.checkpoint, position, context);
}
