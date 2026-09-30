import { ReplayOptionsError } from './errors/ReplayOptionsError.js';

/** Bounds of a replay run. Everything is bounded: timeouts, retries, dialog dismissals, re-auths. */
export interface ReplayOptions {
	/** An operator is present: approvals and takeovers wait for them (step 34). Unattended runs fail with a ref. */
	readonly attended: boolean;
	/** Default bound for resolving a target and acting, when the step has no `timeoutMs`. */
	readonly stepTimeoutMs: number;
	/** Default bound for a checkpoint to hold, when the checkpoint has no `timeoutMs`. */
	readonly checkpointTimeoutMs: number;
	/** How long a slow load may take before it counts as a failed load (step 39). */
	readonly slowLoadBudgetMs: number;
	/** Bounded retry of a step after a failed load (step 40). */
	readonly retry: { readonly max: number; readonly backoffMs: number };
	/** Known dialogs dismissed per step at most (step 38). */
	readonly maxDialogDismissPerStep: number;
	/** Re-authentications per run at most (step 41). */
	readonly maxReauthPerRun: number;
	/** How long an attended intervention (an approval, or a takeover after a hard failure) waits for an operator (step 34). */
	readonly approvalTimeoutMs: number;
}

/** Overrides for `ReplayOptions`; anything omitted takes its default. */
export type ReplayOptionsInput = Partial<Omit<ReplayOptions, 'retry'>> & {
	readonly retry?: Partial<ReplayOptions['retry']>;
};

/** The defaults `resolveReplayOptions` fills in (unattended; 10 s step/checkpoint bounds; 15 s slow-load budget). */
export const DEFAULT_REPLAY_OPTIONS: ReplayOptions = Object.freeze({
	attended: false,
	stepTimeoutMs: 10_000,
	checkpointTimeoutMs: 10_000,
	slowLoadBudgetMs: 15_000,
	retry: Object.freeze({ max: 2, backoffMs: 500 }),
	maxDialogDismissPerStep: 1,
	maxReauthPerRun: 1,
	approvalTimeoutMs: 300_000,
});

function bounded(option: string, value: number, min: number, max: number): number {
	if (!Number.isInteger(value) || value < min || value > max) {
		throw new ReplayOptionsError(option, `an integer from ${min} to ${max}`);
	}
	return value;
}

/**
 * Applies the defaults and checks every bound.
 *
 * @throws ReplayOptionsError when an option is not an integer within its bounds (a caller error).
 */
export function resolveReplayOptions(input: ReplayOptionsInput = {}): ReplayOptions {
	const d = DEFAULT_REPLAY_OPTIONS;
	return {
		attended: input.attended ?? d.attended,
		stepTimeoutMs: bounded('stepTimeoutMs', input.stepTimeoutMs ?? d.stepTimeoutMs, 1, 300_000),
		checkpointTimeoutMs: bounded('checkpointTimeoutMs', input.checkpointTimeoutMs ?? d.checkpointTimeoutMs, 1, 300_000),
		slowLoadBudgetMs: bounded('slowLoadBudgetMs', input.slowLoadBudgetMs ?? d.slowLoadBudgetMs, 1, 300_000),
		retry: {
			max: bounded('retry.max', input.retry?.max ?? d.retry.max, 0, 5),
			backoffMs: bounded('retry.backoffMs', input.retry?.backoffMs ?? d.retry.backoffMs, 0, 30_000),
		},
		maxDialogDismissPerStep: bounded(
			'maxDialogDismissPerStep',
			input.maxDialogDismissPerStep ?? d.maxDialogDismissPerStep,
			0,
			3,
		),
		maxReauthPerRun: bounded('maxReauthPerRun', input.maxReauthPerRun ?? d.maxReauthPerRun, 0, 3),
		approvalTimeoutMs: bounded('approvalTimeoutMs', input.approvalTimeoutMs ?? d.approvalTimeoutMs, 1, 3_600_000),
	};
}
