import type { OutputSpec, RunResult } from '@idp/artifact-schema';
import type { Redactor } from '@idp/policy';
import { redactResultForSink } from '@idp/replay-engine';
import type { Printer } from './Printer.js';

/** Input of `printResult`: the result, the run redactor, the artifact output specs and the run dir. */
export interface PrintResultInput {
	readonly result: RunResult;
	/** The run's redactor (seeded by the replay with the params, credentials and extracted outputs). */
	readonly redactor: Redactor;
	/** The artifact's outputs (sensitive ones are fully masked); `[]` when the artifact was invalid. */
	readonly outputs: readonly OutputSpec[];
	readonly runDir: string;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/**
 * The one-line human summary of a result, from its redacted copy. Sensitive outputs show as `[REDACTED]` — the
 * values themselves are never printed (they are returned to the calling agent in memory, and `result.json` masks
 * them too). Durations are in seconds.
 */
export function summarize(result: RunResult, redactor: Redactor, outputs: readonly OutputSpec[]): string {
	const redacted = redactResultForSink(result, redactor, outputs);
	const artifact =
		redacted.artifact === null ? 'invalid artifact' : `${redacted.artifact.id}@${redacted.artifact.version}`;
	switch (redacted.kind) {
		case 'success': {
			const values = Object.entries(redacted.outputs)
				.map(([name, value]) => `${name}=${String(value)}`)
				.join(', ');
			const recoveries = `${redacted.recoveries} ${redacted.recoveries === 1 ? 'recovery' : 'recoveries'}`;
			const drift = redacted.drift.length === 0 ? '' : `, ${redacted.drift.length} drifted locator(s)`;
			return `success: ${artifact} in ${seconds(redacted.durationMs)}, ${recoveries}${drift}; outputs: ${values || '(none)'}`;
		}
		case 'business_outcome':
			return `business outcome: ${redacted.code} at ${redacted.stepId} (${artifact}): ${redacted.message}`;
		case 'failure': {
			const step = redacted.step === null ? '' : ` at step ${redacted.step.index + 1} (${redacted.step.id})`;
			return `failure: ${redacted.reason}${step} (${artifact}): expected ${redacted.expected}; observed ${redacted.observed}`.replace(
				/\s+/g,
				' ',
			);
		}
	}
}

/**
 * Prints a replay result: the redacted `RunResult` as JSON (the same copy as `result.json`: free text and outputs
 * masked, structural fields verbatim), then the one-line summary and the run dir (both redacted as text).
 */
export function printResult(printer: Printer, input: PrintResultInput): void {
	printer.useRedactor(input.redactor);
	printer.json(redactResultForSink(input.result, input.redactor, input.outputs));
	printer.line(summarize(input.result, input.redactor, input.outputs));
	printer.line(`run dir: ${input.runDir}`);
}
