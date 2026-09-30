/** A retry or re-auth attempt whose outcome is known only once the step is re-attempted. */
export interface PendingRecovery {
	readonly code: string;
	readonly recoveryKind: 'retry' | 'reauth';
	/** 1-based. */
	readonly attempt: number;
	readonly budget: number;
	/** The step being recovered. */
	readonly stepId: string;
}

/**
 * The recoveries one step has used (the per-step budgets of `ReplayOptions`; re-auths are per run, in
 * `RunState`), and the attempt still waiting for its outcome.
 */
export class StepRecovery {
	/** Known dialogs settled at this step (≤ maxDialogDismissPerStep). */
	dismissals = 0;
	/** Retries of this step after a failed load (≤ the retry budget). */
	retries = 0;
	pending: PendingRecovery | null = null;
}
