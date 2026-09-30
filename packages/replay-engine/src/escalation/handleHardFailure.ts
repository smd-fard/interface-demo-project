import type { Step } from '@idp/artifact-schema';
import { ReplayError } from '../errors/ReplayError.js';
import type { StepContext, StepPosition } from '../steps/StepContext.js';
import type { StepOutcome } from '../steps/StepOutcome.js';
import { verifyCheckpoint } from '../steps/verifyCheckpoint.js';
import type { EscalationSession } from './EscalationSession.js';

/** The escalating failure, its step and context, the session to escalate through, and how to re-run the step. */
export interface HandleHardFailureInput {
	/** An escalating hard failure (`shouldEscalate(error.code)`): target_unresolved, checkpoint_failed, … */
	readonly error: ReplayError;
	readonly step: Step;
	readonly position: StepPosition;
	/** The step's context (with its condition detectors), used to re-verify on the live screen. */
	readonly context: StepContext;
	readonly session: EscalationSession;
	/** Runs the step again (read-only kinds without a checkpoint only: extract, wait). */
	readonly rerun: () => Promise<StepOutcome>;
}

const MAX_REASON = 1000;
const MAX_DESCRIPTION = 500;
/** Steps whose effect is read, not made: re-running them after a takeover is how they are verified. */
const RERUN_KINDS: ReadonlySet<Step['kind']> = new Set(['extract', 'wait']);

/**
 * Attended escalation of a hard failure (step 34, AC11). Raises a takeover request through the session (redacted
 * and persisted there, with a masked screenshot) and hands the same live browser to the operator:
 *
 * - resumed (lease RESUMING): re-observe and re-verify the current step's checkpoint on the live screen; if it
 *   holds, reacquire (AGENT) and continue from the next step; if not, fail `checkpoint_failed`. A read-only step
 *   without a checkpoint (extract, wait) is re-run after reacquiring. Any other step without a checkpoint has
 *   nothing to re-verify, so the resume is accepted only when the operator performed at least one action during
 *   the takeover (recorded, policy-allowed): then the step counts as done by the human and the next checkpoint
 *   verifies the screen; otherwise it fails `checkpoint_failed` (resumed without performing the step) instead of
 *   silently skipping it. A condition seen while re-verifying is returned for the catalog.
 * - aborted → `human_aborted`; nobody claimed it within `approvalTimeoutMs`, or the claimed takeover lasted
 *   longer than `takeoverTimeoutMs` → `timeout` (the request expired).
 * - unattended: the request is persisted and the original failure is returned with its ref.
 *
 * Every failure carries the `interventionRequestId`. Bounded: one takeover per step (the caller never re-enters).
 */
export async function handleHardFailure(input: HandleHardFailureInput): Promise<StepOutcome> {
	const { error, step, position, context, session } = input;
	const outcome = await session.escalate(
		{ code: error.code, text: `Expected ${error.expected}; observed ${error.observed}`.slice(0, MAX_REASON) },
		{
			index: position.index,
			id: step.id,
			description: step.description.slice(0, MAX_DESCRIPTION),
			risk: step.risk,
		},
		// The claim is awaited like an approval; once claimed, the operator has the (longer) takeover bound.
		{ timeoutMs: context.options.approvalTimeoutMs, takeoverTimeoutMs: context.options.takeoverTimeoutMs },
	);
	const { requestId } = outcome;
	const fail = (code: ReplayError['code'], observed: string) =>
		new ReplayError(code, {
			step: position,
			expected: `an operator to resolve the ${error.code} at ${step.id}`,
			observed,
			interventionRequestId: requestId,
			cause: error,
		});
	switch (outcome.kind) {
		case 'unattended':
			throw error.withIntervention(requestId);
		case 'timeout':
			throw fail(
				'timeout',
				outcome.stage === 'takeover'
					? `the operator did not hand control back within ${context.options.takeoverTimeoutMs} ms`
					: `no operator took over within ${context.options.approvalTimeoutMs} ms`,
			);
		case 'aborted':
			throw fail('human_aborted', 'the operator aborted the run');
		case 'resumed':
			break;
	}
	try {
		if (step.checkpoint !== undefined) {
			const verified = await verifyCheckpoint(step.checkpoint, position, context);
			await session.lease.reacquire();
			return verified;
		}
		if (RERUN_KINDS.has(step.kind)) {
			await session.lease.reacquire();
			return await input.rerun();
		}
		if (!outcome.humanActions.some((action) => !action.refused)) {
			throw new ReplayError('checkpoint_failed', {
				step: position,
				expected: `the operator to perform ${step.id} (it has no checkpoint to re-verify on resume)`,
				observed: 'the operator resumed without performing any action',
				interventionRequestId: requestId,
				cause: error,
			});
		}
		await session.lease.reacquire();
		return { kind: 'completed' };
	} catch (resumeError) {
		if (resumeError instanceof ReplayError) throw resumeError.withIntervention(requestId);
		throw resumeError;
	}
}
