import type { Step } from '@idp/artifact-schema';
import { ApprovalRequiredError, type ApprovalGrant } from '@idp/surface';
import { ReplayError } from '../errors/ReplayError.js';
import type { StepContext, StepPosition } from '../steps/StepContext.js';
import type { StepOutcome } from '../steps/StepOutcome.js';
import type { EscalationSession } from './EscalationSession.js';

/** The guard's refusal, its step and context, the session to ask, and how to retry the step with a grant. */
export interface HandleApprovalInput {
	/** What the guard threw: the irreversible action did not happen. */
	readonly error: ApprovalRequiredError;
	readonly step: Step;
	readonly position: StepPosition;
	readonly context: StepContext;
	readonly session: EscalationSession;
	/** Runs the same step again with the grant (`StepContext.approvalGrant`). */
	readonly retry: (grant: ApprovalGrant) => Promise<StepOutcome>;
}

const MAX_DESCRIPTION = 500;

/**
 * The approval gate (step 34, AC10). An irreversible step was refused by the guard for lack of a grant, so
 * nothing happened on screen. Raises an approval request through the session (redacted there, persisted):
 *
 * - attended, approved: the lease is already back in AGENT; retry the same step once with the single-use grant.
 *   The guard consumes it, and a click's own native confirm is accepted as part of the approved action.
 * - attended, rejected → `approval_rejected`; nobody answered in time → `timeout`; aborted → `human_aborted`.
 * - unattended: the request is persisted and the run fails with `approval_required` and its ref.
 *
 * Every failure carries the `interventionRequestId`. Bounded: one request per refused step, one retry per grant.
 */
export async function handleApproval(input: HandleApprovalInput): Promise<StepOutcome> {
	const { error, step, position, context, session } = input;
	const outcome = await session.requestApproval(
		{ index: position.index, stepId: step.id, description: step.description.slice(0, MAX_DESCRIPTION) },
		{ timeoutMs: context.options.approvalTimeoutMs },
	);
	const fail = (code: ReplayError['code'], observed: string, cause: unknown = error) =>
		new ReplayError(code, {
			step: position,
			expected: `an operator approval for the irreversible ${step.kind}`,
			observed,
			interventionRequestId: outcome.requestId,
			cause,
		});
	switch (outcome.kind) {
		case 'granted':
			try {
				return await input.retry(outcome.grant);
			} catch (retryError) {
				// The guard refused the grant itself (reused, expired, bound elsewhere): never ask again in a loop.
				if (!(retryError instanceof ApprovalRequiredError)) throw retryError;
				throw fail(
					'approval_required',
					`the approval grant was not accepted (${retryError.grantRejection ?? 'unknown'})`,
					retryError,
				);
			}
		case 'rejected':
			throw fail('approval_rejected', 'the operator rejected the action');
		case 'timeout':
			throw fail('timeout', `no operator answered within ${context.options.approvalTimeoutMs} ms`);
		case 'aborted':
			throw fail('human_aborted', 'the operator aborted the run');
		case 'unattended':
			throw fail('approval_required', `${error.actionKind} requires approval; the request is waiting for an operator`);
	}
}
