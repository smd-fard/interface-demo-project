import { FAILURE_REASONS, type FailureReason } from '@idp/artifact-schema';

/** Recoverable codes an artifact or profile may declare `failure`: the reason each then ends the run with. */
const RECOVERABLE_AS_FAILURE: Readonly<Record<string, FailureReason>> = Object.freeze({
	known_dialog: 'unknown_dialog',
	session_timeout: 'session_lost',
	slow_load: 'timeout',
	failed_load: 'timeout',
});

/**
 * The failure reason a `failure`-class condition ends the run with: its own code when that is a failure reason
 * (app_error, unknown_dialog, …); the nearest reason for a recoverable code an artifact or profile declared a
 * failure; `app_error` for an app-specific code (a failure rule recognises a state of the app, e.g. its outage
 * page). Deterministic: never a guess at runtime, only this table.
 */
export function failureReasonFor(code: string): FailureReason {
	if ((FAILURE_REASONS as readonly string[]).includes(code)) return code as FailureReason;
	return RECOVERABLE_AS_FAILURE[code] ?? 'app_error';
}
