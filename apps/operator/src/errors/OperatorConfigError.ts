/** The operator console's environment is missing or invalid (names the variable, never its value). */
export class OperatorConfigError extends Error {
	readonly code = 'OPERATOR_CONFIG' as const;

	constructor(
		readonly variable: string,
		message: string,
		options?: ErrorOptions,
	) {
		super(`${variable} ${message}`, options);
		this.name = 'OperatorConfigError';
	}
}
