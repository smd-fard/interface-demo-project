/** Thrown when an existing run directory or run file cannot be read. Wraps the fs error as `cause`. */
export class EvidenceReadError extends Error {
	readonly code = 'EVIDENCE_READ_FAILED' as const;

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'EvidenceReadError';
	}
}
