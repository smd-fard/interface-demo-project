import type { OutputSpec, RunResult } from '@idp/artifact-schema';
import { FULL_MASK, type Redacted, type Redactor } from '@idp/policy';

/**
 * The copy of a result that may be written to a sink (`result.json`). Only free text and output values pass
 * through the redactor; structural fields (ids, hashes, durations, counts, enums, evidence refs) are kept
 * verbatim, because masking them (a 5-digit duration looks like a member number) would break the contract.
 * Sensitive outputs are fully masked; non-sensitive outputs still go through the redactor.
 */
export function redactResultForSink(
	result: RunResult,
	redactor: Redactor,
	outputs: readonly OutputSpec[],
): Redacted<RunResult> {
	// Every free-text field is masked below; the rest is structural (see the doc comment).
	const brand = (copy: RunResult) => copy as Redacted<RunResult>;
	switch (result.kind) {
		case 'success': {
			const sensitive = new Set(outputs.filter((spec) => spec.sensitive).map((spec) => spec.name));
			const masked: Record<string, string | number | boolean> = {};
			for (const [name, value] of Object.entries(result.outputs)) {
				masked[name] = sensitive.has(name) ? FULL_MASK : (redactor.redact(value) as string | number | boolean);
			}
			return brand({ ...result, outputs: masked });
		}
		case 'business_outcome':
			return brand({ ...result, message: redactor.redactString(result.message) });
		case 'failure':
			return brand({
				...result,
				expected: redactor.redactString(result.expected),
				observed: redactor.redactString(result.observed),
			});
	}
}
