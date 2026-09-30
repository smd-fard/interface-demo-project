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
	/**
	 * Whether the step's checkpoint already held before the step was first attempted (`null`: not recorded — no
	 * checkpoint, or no condition rules). A retry's reload counts the step as done by its checkpoint only when it
	 * did not hold before (or the step is read-only), so a step whose checkpoint proves nothing is re-executed.
	 */
	checkpointHeldBefore: boolean | null = null;
}
