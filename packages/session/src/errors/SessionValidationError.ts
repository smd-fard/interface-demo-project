/**
 * An input to the session was malformed: an operator handle, a reason, an intervention request, a control API
 * body. The message names the field, never its value. The control API answers it with 400.
 */
export class SessionValidationError extends Error {
	readonly code = 'SESSION_VALIDATION' as const;

	constructor(
		/** The field that failed, e.g. `operator`. */
		readonly field: string,
		message: string,
	) {
		super(`${field}: ${message}`);
		this.name = 'SessionValidationError';
	}
}
