import type { StepRunResult } from '../steps/StepRunResult.js';
import type { DetectedCondition } from './DetectedCondition.js';

/**
 * The bounded recovery a recoverable condition gets, with its budget already applied from `ReplayOptions`
 * (the step runner performs it and logs every attempt as `recovery`):
 * - `dismiss_dialog`: settle the pending dialog whose message contains `match` (≤ maxDialogDismissPerStep per step);
 * - `retry`: reload from the entry route and re-run the step (≤ `max` times, `backoffMs` before each);
 * - `reauth`: re-run the login steps, then the main steps up to this one (≤ maxReauthPerRun per run);
 * - `wait`: one bounded wait for the step's checkpoint, up to slowLoadBudgetMs from the action.
 */
export type RecoveryPlan =
	| { readonly kind: 'dismiss_dialog'; readonly match: string; readonly action: 'accept' | 'dismiss' }
	| { readonly kind: 'retry'; readonly max: number; readonly backoffMs: number }
	| { readonly kind: 'reauth' }
	| { readonly kind: 'wait' };

/** How `respondToCondition` answered (a `failure`-class condition is thrown as a `ReplayError` instead). */
export type ConditionReply =
	| { readonly kind: 'outcome'; readonly result: Extract<StepRunResult, { kind: 'business_outcome' }> }
	| { readonly kind: 'recover'; readonly plan: RecoveryPlan; readonly condition: DetectedCondition };
