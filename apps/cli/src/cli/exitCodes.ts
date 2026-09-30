import type { RunResult } from '@idp/artifact-schema';

/**
 * The process exit codes of `idp`. A business outcome is not a failure (invariant 4), so it has its own code.
 */
export const EXIT = Object.freeze({
	/** Replay `success`, discovery goal met (and verified), catalog verified. */
	success: 0,
	/** Replay `failure`, any error (config, credentials, missing API key, artifact file), catalog mismatch. */
	failure: 1,
	/** Replay `business_outcome` (e.g. `member_not_found`). */
	businessOutcome: 3,
	/** Discovery stopped without meeting its goal (no artifact). */
	discoveryStopped: 4,
	/** Usage error (EX_USAGE): unknown flag, missing or malformed value. */
	usage: 64,
});

/** One of the `EXIT` values. */
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** The exit code for a replay result. */
export function exitCodeFor(result: RunResult): ExitCode {
	switch (result.kind) {
		case 'success':
			return EXIT.success;
		case 'business_outcome':
			return EXIT.businessOutcome;
		case 'failure':
			return EXIT.failure;
	}
}
