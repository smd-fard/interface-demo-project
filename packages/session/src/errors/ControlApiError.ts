/**
 * The control API answered with an error (or with something that is not the contract). `status` is the HTTP
 * status (0 when the server could not be reached), `apiCode` the server's error code, e.g.
 * `ILLEGAL_LEASE_TRANSITION`, `UNAUTHORIZED`, `INVALID_RESPONSE`, `UNREACHABLE`.
 */
export class ControlApiError extends Error {
	readonly code = 'CONTROL_API_ERROR' as const;

	constructor(
		readonly status: number,
		readonly apiCode: string,
		message: string,
		options?: ErrorOptions,
	) {
		super(`control API ${status} ${apiCode}: ${message}`, options);
		this.name = 'ControlApiError';
	}
}
