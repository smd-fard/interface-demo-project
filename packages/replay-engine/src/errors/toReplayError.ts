import type { Step } from '@idp/artifact-schema';
import { LeaseNotHeldError } from '@idp/session';
import {
	ActionFailedError,
	BindingMissingError,
	DialogMismatchError,
	DialogPendingError,
	FrameNotFoundError,
	NavigationBlockedError,
	NoDialogPendingError,
	OptionNotFoundError,
	PolicyDeniedError,
	SurfaceClosedError,
	TargetNotResolvedError,
	WaitTimeoutError,
} from '@idp/surface';
import { describeCheckpoint } from '../checkpoints/describeCheckpoint.js';
import { CredentialNotFoundError } from '../params/CredentialNotFoundError.js';
import { ReplayError } from './ReplayError.js';

function targetOf(step: Step): string {
	return 'target' in step && step.target !== undefined ? step.target.description : `the ${step.kind} step`;
}

/**
 * Maps an error thrown while running a step to the `ReplayError` (and so the `FailureReason`) it ends the run
 * with, or `null` for an error that is not a run-level problem (a bug: the caller rethrows it). Never includes
 * a typed or extracted value: only descriptions, rung counts, codes and surface `observed` strings (redacted
 * later by the ResultBuilder). `ApprovalRequiredError` is not mapped here: it is a distinct signal the step
 * runner handles (step 34).
 */
export function toReplayError(error: unknown, step: Step, index: number): ReplayError | null {
	if (error instanceof ReplayError) return error;
	const at = { index, id: step.id };
	const fail = (code: ReplayError['code'], expected: string, observed: string) =>
		new ReplayError(code, { step: at, expected, observed, cause: error });

	if (error instanceof TargetNotResolvedError) {
		const counts = error.rungs.map((rung) => `rung ${rung.index} ${rung.kind}: ${rung.matches} matches`).join('; ');
		return fail('target_unresolved', `${error.target} resolved by exactly one element`, counts);
	}
	if (error instanceof FrameNotFoundError) {
		return fail(
			'target_unresolved',
			`the frame of ${targetOf(step)}`,
			`frame hop ${error.hop}: ${error.matches} frames`,
		);
	}
	if (error instanceof OptionNotFoundError) {
		return fail(
			'target_unresolved',
			`the option of ${error.target}`,
			`no matching option (${error.optionCount} options)`,
		);
	}
	if (error instanceof PolicyDeniedError) {
		return fail(
			'policy_denied',
			`${step.kind} allowed by policy`,
			`${error.denyCode} (${error.stage === 'pre_action' ? 'not performed' : 'landed off the allowlist'})`,
		);
	}
	if (error instanceof NavigationBlockedError) {
		return fail(
			'policy_denied',
			`${step.kind} to stay on the allowlist`,
			`navigation to ${error.blockedOrigin} blocked`,
		);
	}
	if (error instanceof WaitTimeoutError) {
		const expected = step.kind === 'wait' ? describeCheckpoint(step.until) : `the ${step.kind} step to complete`;
		return fail('checkpoint_failed', expected, error.observed);
	}
	if (error instanceof ActionFailedError) {
		return error.reason === 'timeout'
			? fail('timeout', `${step.kind} on ${targetOf(step)} to complete in time`, 'the action timed out')
			: fail('checkpoint_failed', `${step.kind} on ${targetOf(step)} to complete`, 'the browser refused the action');
	}
	if (error instanceof DialogPendingError) {
		return fail(
			'unknown_dialog',
			`no native dialog before ${step.kind}`,
			`a native ${error.dialogType} dialog is pending`,
		);
	}
	if (error instanceof DialogMismatchError) {
		return fail('unknown_dialog', `a dialog containing "${error.match}"`, `a different ${error.dialogType} dialog`);
	}
	if (error instanceof NoDialogPendingError) {
		return fail('checkpoint_failed', `a dialog containing "${error.match}"`, 'no native dialog is pending');
	}
	if (error instanceof BindingMissingError || error instanceof CredentialNotFoundError) {
		return fail(
			'invalid_params',
			'every value the step needs',
			error instanceof BindingMissingError
				? `no value for {{${error.placeholder}}}`
				: `no credential for "${error.ref}"`,
		);
	}
	if (error instanceof LeaseNotHeldError || error instanceof SurfaceClosedError) {
		return fail('session_lost', 'the automation to hold a live session', error.code);
	}
	return null;
}
