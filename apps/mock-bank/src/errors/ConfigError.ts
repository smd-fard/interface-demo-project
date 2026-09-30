import { MockBankError } from './MockBankError.js';

/** An environment variable or config value is malformed. */
export class ConfigError extends MockBankError {
	readonly code = 'MOCKBANK_CONFIG_INVALID';
}
