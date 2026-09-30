import type { ConditionClass, FailureReason, Recovery } from '@idp/artifact-schema';

/** Every runtime condition the engine knows (the taxonomy of R3.3/R3.4). */
export const CONDITION_CODES = [
	'member_not_found',
	'validation_rejected',
	'permission_denied',
	'known_dialog',
	'slow_load',
	'failed_load',
	'session_timeout',
	'unknown_dialog',
	'app_error',
	'target_unresolved',
	'checkpoint_failed',
] as const;
/** A runtime-condition code the catalog knows. */
export type ConditionCode = (typeof CONDITION_CODES)[number];

/**
 * How a condition is recognised. `signature`: an OutcomeRule signature (artifact or profile) evaluated over an
 * `Observation` by `detectConditions` — visible text, titles, routes, dialog text, load status, all signals a
 * non-DOM surface also has (R7.1). The others are engine mechanisms: `native_dialog` (the pending dialog before a
 * step, matched against the profile's known dialogs), `load_timing` (a navigation slower than its budget),
 * `locator` (no ladder rung resolved uniquely), `checkpoint` (a checkpoint did not hold in time).
 */
export type DetectorId = 'signature' | 'native_dialog' | 'load_timing' | 'locator' | 'checkpoint';

/** The deliberate response to a condition of a class. */
export type ConditionResponse =
	/** business_outcome: stop cleanly, no retry, return `business_outcome{code, message}`. */
	| { readonly kind: 'return_outcome' }
	/** recoverable: a bounded recovery, each attempt logged; exhausted → `recovery_exhausted` (or escalate). */
	| { readonly kind: 'recover'; readonly recovery: Recovery['kind'] | 'wait' }
	/** failure: stop with evidence as `reason`; `escalate` → raise a takeover request first (step 34). */
	| { readonly kind: 'fail'; readonly reason: FailureReason; readonly escalate: boolean };

/** One catalog row: a condition code's default class, detector, response and recovery budget. */
export interface ConditionCatalogEntry {
	readonly code: ConditionCode;
	/** The class when neither the artifact nor the app profile declares one (resolution: artifact → profile → this). */
	readonly defaultClass: ConditionClass;
	readonly detector: DetectorId;
	readonly response: ConditionResponse;
	/** Recovery attempts allowed (per step, or per run for re-auth); 0 for outcomes and failures. Always bounded. */
	readonly budget: number;
	readonly description: string;
}

const businessOutcome = (code: ConditionCode, description: string): ConditionCatalogEntry => ({
	code,
	defaultClass: 'business_outcome',
	detector: 'signature',
	response: { kind: 'return_outcome' },
	budget: 0,
	description,
});

const hardFailure = (code: ConditionCode & FailureReason, detector: DetectorId, description: string) =>
	({
		code,
		defaultClass: 'failure',
		detector,
		response: { kind: 'fail', reason: code, escalate: true },
		budget: 0,
		description,
	}) satisfies ConditionCatalogEntry;

/**
 * The condition catalog: the engine's default classification and response per code (define-runtime-condition
 * touch point 3). The artifact's `outcomeRules` and the app profile's `conditions` override the class for their
 * scope (`resolveRules`); nothing is guessed at runtime.
 */
export const CONDITION_CATALOG: Readonly<Record<ConditionCode, ConditionCatalogEntry>> = Object.freeze({
	member_not_found: businessOutcome('member_not_found', 'The search found no member with that number.'),
	validation_rejected: businessOutcome('validation_rejected', 'The app rejected an input value as invalid.'),
	permission_denied: businessOutcome('permission_denied', 'The operator is not entitled to this function.'),
	known_dialog: {
		code: 'known_dialog',
		defaultClass: 'recoverable',
		detector: 'native_dialog',
		response: { kind: 'recover', recovery: 'dismiss_dialog' },
		budget: 1,
		description:
			'A native dialog the artifact or the app profile lists as known; settled as configured, at most maxDialogDismissPerStep times per step (step 38).',
	},
	slow_load: {
		code: 'slow_load',
		defaultClass: 'recoverable',
		detector: 'load_timing',
		response: { kind: 'recover', recovery: 'wait' },
		budget: 1,
		description:
			'The load a step started had not settled within the step bound: one bounded wait for its checkpoint, up to slowLoadBudgetMs from the action (logged as recovery kind retry, attempt 1 of 1); past the budget it counts as failed_load (step 39).',
	},
	failed_load: {
		code: 'failed_load',
		defaultClass: 'recoverable',
		detector: 'signature',
		response: { kind: 'recover', recovery: 'retry' },
		budget: 2,
		description:
			'A page load failed (HTTP 5xx without the app error page): the step is retried after a backoff, from the entry route (step 40).',
	},
	session_timeout: {
		code: 'session_timeout',
		defaultClass: 'recoverable',
		detector: 'signature',
		response: { kind: 'recover', recovery: 'reauth' },
		budget: 1,
		description:
			'The session expired: re-run the login steps once, then the main steps up to the failed one (step 41).',
	},
	unknown_dialog: hardFailure(
		'unknown_dialog',
		'native_dialog',
		'A native dialog no rule recognises; left unaccepted (step 42).',
	),
	app_error: hardFailure('app_error', 'signature', 'The app showed its error page (step 43).'),
	target_unresolved: hardFailure('target_unresolved', 'locator', 'No locator rung resolved the target uniquely.'),
	checkpoint_failed: hardFailure('checkpoint_failed', 'checkpoint', 'A checkpoint did not hold in time.'),
});

/** The catalog entry of a code, or `null` for a code the catalog does not know (e.g. an app-specific rule). */
export function catalogEntry(code: string): ConditionCatalogEntry | null {
	return (CONDITION_CODES as readonly string[]).includes(code) ? CONDITION_CATALOG[code as ConditionCode] : null;
}

/**
 * Whether a failure reason is a hard failure that escalates to a human (attended: takeover; unattended: a
 * persisted request ref): the catalog's `fail` responses with `escalate`. Input, policy and approval failures and
 * business outcomes never escalate.
 */
export function shouldEscalate(reason: FailureReason): boolean {
	const entry = catalogEntry(reason);
	return entry !== null && entry.response.kind === 'fail' && entry.response.escalate;
}
