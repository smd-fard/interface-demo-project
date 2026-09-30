import { z } from 'zod';

/**
 * Why a run failed. Grouped: input (invalid_params, artifact_invalid); policy (policy_denied, approval_required,
 * approval_rejected); screen (target_unresolved, checkpoint_failed, unknown_dialog, app_error,
 * recovery_exhausted); run (output_invalid, session_lost, human_aborted, timeout). There is no member for a
 * recoverable condition or a business outcome, by construction (invariant 4).
 */
export const FAILURE_REASONS = [
	'invalid_params',
	'artifact_invalid',
	'policy_denied',
	'approval_required',
	'approval_rejected',
	'target_unresolved',
	'checkpoint_failed',
	'unknown_dialog',
	'app_error',
	'recovery_exhausted',
	'output_invalid',
	'session_lost',
	'human_aborted',
	'timeout',
] as const;

export const FailureReasonSchema = z
	.enum(FAILURE_REASONS)
	.describe(
		'Stable failure code. invalid_params: params failed validation. artifact_invalid: the artifact failed schema/hash checks. policy_denied: the policy refused an action. approval_required: an irreversible step needed approval and none was available (unattended). approval_rejected: an operator rejected it. target_unresolved: no locator rung matched uniquely. checkpoint_failed: a checkpoint did not hold. unknown_dialog: an unrecognised dialog appeared. app_error: the app showed an error page. recovery_exhausted: a bounded recovery ran out. output_invalid: an extracted output failed its type. session_lost: the session could not be re-established. human_aborted: an operator aborted. timeout: the run exceeded its time budget.',
	);
export type FailureReason = z.infer<typeof FailureReasonSchema>;
