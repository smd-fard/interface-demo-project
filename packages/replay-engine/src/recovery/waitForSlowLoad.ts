import type { Checkpoint } from '@idp/artifact-schema';
import type { CheckpointVerdict } from '../checkpoints/CheckpointVerdict.js';
import type { StepContext, StepPosition } from '../steps/StepContext.js';
import type { StepOutcome } from '../steps/StepOutcome.js';
import { logCheckpoint } from '../steps/verifyCheckpoint.js';
import { logRecovery } from './logRecovery.js';

/** The code a slow load past its budget continues as (the failed-load path, step 40). */
export const FAILED_LOAD = 'failed_load';

/** The step checkpoint to wait for and when the action began (the slow-load budget counts from it). */
export interface WaitForSlowLoadInput {
	readonly checkpoint: Checkpoint;
	readonly position: StepPosition;
	readonly context: StepContext;
	/** When the step's action began (clock ms): the budget counts from here. */
	readonly startedAt: number;
}

/**
 * The bounded wait for a slow load (step 39): the step's checkpoint is polled (raced against the step's condition
 * detectors) until `slowLoadBudgetMs` after the action began. Logged as one `recovery` attempt (kind `retry`,
 * attempt 1 of 1).
 *
 * - held → the step completed (recovery succeeded);
 * - another condition showed (e.g. the load ended as an error page) → that condition, for the step runner;
 * - the budget ran out → the load counts as failed: `failed_load` (recovery failed), which the step runner
 *   retries with the failed-load budget. The checkpoint is never assumed.
 */
export async function waitForSlowLoad({
	checkpoint,
	position,
	context,
	startedAt,
}: WaitForSlowLoadInput): Promise<StepOutcome> {
	const budgetMs = context.options.slowLoadBudgetMs;
	const remaining = budgetMs - (context.clock.now().getTime() - startedAt);
	const verdict: CheckpointVerdict =
		remaining > 0
			? await context.verifier.verify(checkpoint, context.binder.bindings, remaining)
			: { kind: 'timeout', observed: 'the slow-load budget was already spent' };
	logCheckpoint(checkpoint, position, verdict, context);
	const attempt = { code: 'slow_load', recoveryKind: 'retry', attempt: 1, budget: 1, stepId: position.id } as const;
	switch (verdict.kind) {
		case 'held':
			logRecovery({ ...attempt, outcome: 'succeeded' }, context);
			return { kind: 'completed' };
		case 'condition':
			// The load finished (as something else): the wait did its job; the condition gets its own response.
			logRecovery({ ...attempt, outcome: 'succeeded' }, context);
			return { kind: 'condition', code: verdict.code };
		case 'timeout':
			logRecovery({ ...attempt, outcome: 'failed' }, context);
			return {
				kind: 'condition',
				code: FAILED_LOAD,
				detail: `the load did not settle within slowLoadBudgetMs (${budgetMs} ms); treated as a failed load`,
			};
	}
}
