import type { StepContext } from '../steps/StepContext.js';

/** One bounded recovery attempt, as logged in a `recovery` run-log entry. */
export interface RecoveryAttempt {
	readonly code: string;
	/**
	 * The recovery that ran. A slow load's bounded wait is logged as `retry` (attempt 1 of 1: the checkpoint is
	 * polled again within slowLoadBudgetMs); the log contract has no separate `wait` kind.
	 */
	readonly recoveryKind: 'dismiss_dialog' | 'retry' | 'reauth';
	readonly attempt: number;
	readonly budget: number;
	readonly outcome: 'succeeded' | 'failed';
	readonly stepId: string | null;
}

/**
 * Logs one bounded recovery attempt (`recovery` entry) and counts it in the run's `recoveries`. Recoveries are
 * logged, never returned as a result (invariant 4).
 */
export function logRecovery(attempt: RecoveryAttempt, context: StepContext): void {
	context.runLog.log({
		kind: 'recovery',
		at: context.clock.now().toISOString(),
		runId: context.runId,
		actor: 'replay',
		...attempt,
	});
	context.state.recoveries += 1;
}
