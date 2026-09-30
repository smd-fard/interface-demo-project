/** A model call failed (HTTP error, connection error, malformed response). Never carries the API key. */
export class ModelCallError extends Error {
	readonly code = 'MODEL_CALL_FAILED' as const;

	constructor(
		message: string,
		/** The HTTP status, when the provider answered. */
		readonly status: number | undefined,
		/** True for rate limits, overload, server errors and connection failures. */
		readonly retryable: boolean,
	) {
		super(message);
		this.name = 'ModelCallError';
	}
}
