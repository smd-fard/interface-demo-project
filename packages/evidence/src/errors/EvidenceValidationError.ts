/** One validation problem: where it is and what is wrong. Matches the shape of a Zod issue. */
export interface EvidenceIssue {
	readonly path: readonly PropertyKey[];
	readonly message: string;
}

/**
 * Thrown when data handed to an evidence sink (a run-log entry, result, artifact, manifest, evidence name or
 * path) does not validate against its contract. Nothing is written when this is thrown.
 */
export class EvidenceValidationError extends Error {
	readonly code = 'EVIDENCE_INVALID' as const;

	constructor(
		message: string,
		readonly issues: readonly EvidenceIssue[] = [],
		options?: ErrorOptions,
	) {
		const detail = issues.map((issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`);
		super(detail.length === 0 ? message : `${message} (${detail.join('; ')})`, options);
		this.name = 'EvidenceValidationError';
	}
}
