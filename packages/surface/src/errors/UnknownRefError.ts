/** An observation ref (`e<N>`) is not in the latest observation: it is stale or was never issued. */
export class UnknownRefError extends Error {
	readonly code = 'REF_UNKNOWN' as const;

	constructor(readonly ref: string) {
		super(`ref ${ref} is not in the latest observation; observe again`);
		this.name = 'UnknownRefError';
	}
}
