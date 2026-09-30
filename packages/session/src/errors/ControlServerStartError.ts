/** The control server could not start (e.g. the port is taken, or the token source is not hex). */
export class ControlServerStartError extends Error {
	readonly code = 'CONTROL_SERVER_START' as const;

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'ControlServerStartError';
	}
}
