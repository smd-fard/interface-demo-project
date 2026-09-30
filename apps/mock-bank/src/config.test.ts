import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, loadConfig } from './config.js';
import { ConfigError } from './errors/ConfigError.js';

describe('loadConfig', () => {
	it('uses the defaults for an empty environment', () => {
		expect(loadConfig({})).toEqual(DEFAULT_CONFIG);
	});

	it('reads every variable', () => {
		expect(
			loadConfig({
				MOCKBANK_HOST: '0.0.0.0',
				MOCKBANK_PORT: '0',
				MOCKBANK_TENANT: 'B',
				MOCKBANK_SESSION_IDLE_MS: '500',
				MOCKBANK_SLOW_MS: '100',
				MOCKBANK_FAULTS: 'app_error',
			}),
		).toEqual({
			host: '0.0.0.0',
			port: 0,
			tenant: 'b',
			sessionIdleMs: 500,
			slowMs: 100,
			faults: [{ code: 'app_error', mode: 'once' }],
		});
	});

	it.each([
		['MOCKBANK_PORT', 'abc'],
		['MOCKBANK_PORT', '70000'],
		['MOCKBANK_TENANT', 'c'],
		['MOCKBANK_SLOW_MS', '-5'],
	])('rejects %s=%s', (name, value) => {
		expect(() => loadConfig({ [name]: value })).toThrow(ConfigError);
	});
});
