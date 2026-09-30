import { ApprovalRequiredError, PolicyDeniedError } from '@idp/surface';
import { ReplayError } from '../errors/ReplayError.js';
import type { StepPosition } from '../steps/StepContext.js';

function typedCode(error: unknown): string | null {
	if (error instanceof Error && 'code' in error && typeof error.code === 'string') return error.code;
	return null;
}

/**
 * The run failure a recovery action (settling a known dialog, reloading the entry route) ends with when the
 * surface refuses it: `policy_denied` for a policy refusal, `recovery_exhausted` for any other typed surface or
 * session error (including an approval the policy requires: a recovery never asks for one). `null` for an untyped
 * error — a bug the caller rethrows.
 */
export function recoveryFailure(error: unknown, what: string, position: StepPosition | null): ReplayError | null {
	if (error instanceof ReplayError) return error;
	if (error instanceof PolicyDeniedError) {
		return new ReplayError('policy_denied', {
			step: position,
			expected: `${what} allowed by policy`,
			observed: `${error.denyCode} (${error.stage === 'pre_action' ? 'not performed' : 'landed off the allowlist'})`,
			cause: error,
		});
	}
	if (error instanceof ApprovalRequiredError) {
		return new ReplayError('recovery_exhausted', {
			step: position,
			expected: `${what} without an approval`,
			observed: 'the policy requires an approval for it; a recovery never asks for one',
			cause: error,
		});
	}
	const code = typedCode(error);
	if (code === null) return null;
	return new ReplayError('recovery_exhausted', {
		step: position,
		expected: `${what} to succeed`,
		observed: `the surface refused it (${code})`,
		cause: error,
	});
}
