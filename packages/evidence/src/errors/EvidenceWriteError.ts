/** Thrown when a run file, log line or evidence file cannot be written. Wraps the fs error as `cause`. */
export class EvidenceWriteError extends Error {
	readonly code = 'EVIDENCE_WRITE_FAILED' as const;

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'EvidenceWriteError';
	}
}
