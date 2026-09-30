import type { ConditionMatch } from '../conditions/detectConditions.js';

/** How one step ended, short of a failure (failures are thrown as `ReplayError`). */
export type StepOutcome =
	| { readonly kind: 'completed' }
	/** A runtime condition was detected (before the step, instead of its checkpoint, or while recovering). */
	| {
			readonly kind: 'condition';
			readonly code: string;
			/**
			 * The engine's description of an engine-detected condition (slow load, a load past its budget). Set only
			 * for those: a signature condition is looked up in the step's watch instead.
			 */
			readonly detail?: string;
			/** The rule match, when the condition was seen outside the current step's watch (a recovery re-run). */
			readonly match?: ConditionMatch;
			/** When the step's action began (clock ms), for `slow_load`'s bounded wait. */
			readonly startedAt?: number;
			/** Seen while re-running steps for a recovery: in-place recoveries (dismiss, wait) are not nested. */
			readonly during?: 'retry' | 'reauth';
			/** The step it was seen at, when that is not the current step (a recovery re-run). */
			readonly at?: { readonly index: number; readonly id: string };
	  };
