/** A discovery option or input is invalid (a non-positive budget, an unknown example input, …). */
export class DiscoveryConfigError extends Error {
	readonly code = 'DISCOVERY_CONFIG_INVALID' as const;

	constructor(
		/** The option or input at fault, e.g. `maxSteps`. */
		readonly field: string,
		message: string,
	) {
		super(`${field}: ${message}`);
		this.name = 'DiscoveryConfigError';
	}
}
