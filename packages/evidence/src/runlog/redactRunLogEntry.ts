import type { RunLogEntryInput } from '@idp/artifact-schema';
import type { Redacted, Redactor } from '@idp/policy';

/**
 * Keys whose values are machine identifiers, enums, numbers, timestamps, origins or evidence/artifact refs:
 * formats the schema pins down, which cannot carry free text. They are kept verbatim so masking cannot
 * corrupt them (a 5-digit duration or port would otherwise match the member-number pattern, and a sha256
 * could contain one). Every other key — including any key added to the schema later — is redacted.
 */
const STRUCTURAL_KEYS: ReadonlySet<string> = new Set([
	'kind',
	'at',
	'runId',
	'actor',
	'runKind',
	'artifact',
	'origin',
	'snapshotRef',
	'screenshotRef',
	'requestRef',
	'verdict',
	'code',
	'risk',
	'actionKind',
	'stepId',
	'rungIndex',
	'rungKind',
	'checkpointKind',
	'result',
	'class',
	'recoveryKind',
	'attempt',
	'budget',
	'outcome',
	'requestId',
	'interventionKind',
	'event',
	'decision',
	'refused',
	'resultKind',
	'durationMs',
	'tool',
	// Decision metadata: a response id, a model id, a stop-reason enum and integer counts (schema-pinned formats).
	// Token counts and latencies are 5-digit numbers often enough that the member-number pattern would mask them.
	'modelResponse',
]);

/**
 * Redacts a run-log entry: every free-text field (goal, url, title, digest, reason, decision input, target,
 * detail, fingerprint, lease-transition reason, …) passes through the redactor; structural fields are kept.
 */
export function redactRunLogEntry(entry: RunLogEntryInput, redactor: Redactor): Redacted<RunLogEntryInput> {
	const source = entry as unknown as Record<string, unknown>;
	const redacted = redactor.redact(source) as Record<string, unknown>;
	for (const key of Object.keys(source)) {
		if (STRUCTURAL_KEYS.has(key)) redacted[key] = source[key];
	}
	if (entry.kind === 'lease_change') {
		redacted['transition'] = { ...entry.transition, reason: redactor.redactString(entry.transition.reason) };
	}
	return redacted as unknown as Redacted<RunLogEntryInput>;
}
