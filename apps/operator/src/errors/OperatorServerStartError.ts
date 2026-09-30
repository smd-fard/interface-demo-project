/** The operator console could not start listening (e.g. the port is taken). */
export class OperatorServerStartError extends Error {
	readonly code = 'OPERATOR_SERVER_START' as const;

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'OperatorServerStartError';
	}
}
