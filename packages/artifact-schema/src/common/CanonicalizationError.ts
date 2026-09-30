/** Thrown when a value cannot be represented as canonical JSON (NaN, Infinity, bigint, function, symbol). */
export class CanonicalizationError extends Error {
	readonly code = 'not_canonicalizable' as const;

	constructor(
		/** JSONPath-like location of the offending value, e.g. "$.steps[2].timeoutMs". */
		readonly path: string,
		readonly valueType: string,
	) {
		super(`Cannot canonicalize ${valueType} at ${path}`);
		this.name = 'CanonicalizationError';
	}
}
