import type { Checkpoint } from '@idp/artifact-schema';
import type { CheckpointVerdict } from '../checkpoints/CheckpointVerdict.js';
import { describeCheckpoint } from '../checkpoints/describeCheckpoint.js';
import { ReplayError } from '../errors/ReplayError.js';
import type { Landing } from './performAction.js';
import type { StepContext, StepPosition } from './StepContext.js';
import type { StepOutcome } from './StepOutcome.js';

/** The engine-detected code for a load still pending when its action's bound ran out (catalog: recoverable). */
export const SLOW_LOAD = 'slow_load';

/** Logs a `checkpoint` entry for a verdict (`detail`: what the surface saw, bounded; redacted by the run log). */
export function logCheckpoint(
	checkpoint: Checkpoint,
	position: StepPosition | null,
	verdict: CheckpointVerdict,
	context: StepContext,
): void {
	context.runLog.log({
		kind: 'checkpoint',
		at: context.clock.now().toISOString(),
		runId: context.runId,
		actor: 'replay',
		stepId: position?.id ?? null,
		checkpointKind: checkpoint.kind,
		result: verdict.kind === 'held' ? 'held' : verdict.kind === 'condition' ? 'condition' : 'failed',
		...(verdict.kind === 'timeout' ? { detail: verdict.observed.slice(0, 1000) } : {}),
	});
}

/**
 * Verifies a checkpoint after an action (invariant 5) and logs a `checkpoint` entry. `position` null means the
 * artifact's success condition. Not held → `ReplayError` `checkpoint_failed` (expected: the checkpoint's
 * description; observed: what the surface saw, redacted when the result is built). A detected condition is
 * returned for the step runner to resolve.
 *
 * With a `landing` whose load is still pending (the action ran to its bound, step 39), the checkpoint is checked
 * once: held → done; otherwise the step is reported as `slow_load` and the step runner waits for it, bounded by
 * `slowLoadBudgetMs` from the action. A checkpoint that does not hold is never ignored: the wait ends held, as
 * another condition, or as a failed load.
 */
export async function verifyCheckpoint(
	checkpoint: Checkpoint | undefined,
	position: StepPosition | null,
	context: StepContext,
	landing?: Landing,
): Promise<StepOutcome> {
	if (checkpoint === undefined) return { kind: 'completed' };
	if (landing?.loadPending === true && position !== null) {
		const first = await context.verifier.verify(checkpoint, context.binder.bindings, 1);
		if (first.kind !== 'timeout') {
			logCheckpoint(checkpoint, position, first, context);
			return first.kind === 'held' ? { kind: 'completed' } : { kind: 'condition', code: first.code };
		}
		const boundMs = Math.max(0, context.clock.now().getTime() - landing.startedAt);
		return {
			kind: 'condition',
			code: SLOW_LOAD,
			detail: `the load ${position.id} started had not settled after ${boundMs} ms (its step bound)`,
			startedAt: landing.startedAt,
		};
	}
	const verdict = await context.verifier.verify(
		checkpoint,
		context.binder.bindings,
		checkpoint.timeoutMs ?? context.options.checkpointTimeoutMs,
	);
	logCheckpoint(checkpoint, position, verdict, context);
	switch (verdict.kind) {
		case 'held':
			return { kind: 'completed' };
		case 'condition':
			return { kind: 'condition', code: verdict.code };
		case 'timeout':
			throw new ReplayError('checkpoint_failed', {
				step: position,
				expected: describeCheckpoint(checkpoint),
				observed: verdict.observed,
			});
	}
}
