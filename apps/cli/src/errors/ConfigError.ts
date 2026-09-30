/** Stable codes of {@link ConfigError}. */
export type ConfigErrorCode = 'unknown_env_var' | 'config_not_found' | 'config_invalid';

/**
 * A config file (`config/policy.json`, `config/apps/<app>.profile.json`) or a config variable is missing or
 * invalid. The message names the file, the variable or the issue path, never a value.
 */
export class ConfigError extends Error {
	constructor(
		readonly code: ConfigErrorCode,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = 'ConfigError';
	}
}
