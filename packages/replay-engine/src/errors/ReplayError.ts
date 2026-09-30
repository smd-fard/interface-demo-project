import type { FailureReason, InterventionId } from '@idp/artifact-schema';

/** The step a replay error belongs to (0-based index in the artifact, and its id). */
export interface ReplayErrorStep {
	readonly index: number;
	readonly id: string;
}

/** The step, expected/observed text, intervention ref and cause a `ReplayError` carries into the failure result. */
export interface ReplayErrorDetails {
	/** The failing step; `null` when the run failed before or outside a step. */
	readonly step: ReplayErrorStep | null;
	/** What the step or check expected. Free text: redacted by the ResultBuilder before any sink. */
	readonly expected: string;
	/** What was observed instead. Free text: redacted by the ResultBuilder before any sink. */
	readonly observed: string;
	/** The intervention request raised for this failure (an approval or a takeover), if any. */
	readonly interventionRequestId?: InterventionId;
	readonly cause?: unknown;
}

/**
 * An internal, typed run failure. Its stable `code` is the `FailureReason` the run ends with; the replay
 * engine turns it into a `failure` result. The message carries the code and step id only — never
 * `expected`/`observed`, which can hold screen text and are redacted only when the result is built.
 */
export class ReplayError extends Error {
	readonly code: FailureReason;
	readonly step: ReplayErrorStep | null;
	readonly expected: string;
	readonly observed: string;
	readonly interventionRequestId: InterventionId | undefined;

	constructor(code: FailureReason, details: ReplayErrorDetails) {
		super(
			`replay failed: ${code}${details.step === null ? '' : ` at step ${details.step.index} (${details.step.id})`}`,
			details.cause === undefined ? undefined : { cause: details.cause },
		);
		this.name = 'ReplayError';
		this.code = code;
		this.step = details.step;
		this.expected = details.expected;
		this.observed = details.observed;
		this.interventionRequestId = details.interventionRequestId;
	}

	/** The same failure, carrying the intervention request raised for it (the result's `interventionRequestId`). */
	withIntervention(interventionRequestId: InterventionId): ReplayError {
		return new ReplayError(this.code, {
			step: this.step,
			expected: this.expected,
			observed: this.observed,
			interventionRequestId,
			cause: this.cause ?? this,
		});
	}

	/** The failure reason of the result (the same value as `code`). */
	get reason(): FailureReason {
		return this.code;
	}
}
