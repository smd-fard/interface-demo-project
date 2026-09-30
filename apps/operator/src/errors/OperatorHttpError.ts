/**
 * A request the console refuses: carries the HTTP status and a stable code (`CSRF_REJECTED`, `HOST_REJECTED`,
 * `NOT_FOUND`, `METHOD_NOT_ALLOWED`, `UNSUPPORTED_MEDIA_TYPE`, `PAYLOAD_TOO_LARGE`, `BAD_GATEWAY`, ...).
 */
export class OperatorHttpError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = 'OperatorHttpError';
	}
}
