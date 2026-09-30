import { describe, expect, it } from 'vitest';
import { loadOperatorConfig } from './config.js';
import { OperatorConfigError } from './errors/OperatorConfigError.js';

const TOKEN = 'ab'.repeat(32);
const env = (overrides: Record<string, string | undefined> = {}) => ({
	IDP_CONTROL_URL: 'http://127.0.0.1:53211',
	IDP_CONTROL_TOKEN: TOKEN,
	...overrides,
});

describe('loadOperatorConfig', () => {
	it('reads the control URL and token, and defaults the port to 4030', () => {
		expect(loadOperatorConfig(env())).toEqual({
			controlUrl: 'http://127.0.0.1:53211',
			controlToken: TOKEN,
			port: 4030,
		});
	});

	it('reads IDP_OPERATOR_PORT; 0 means an ephemeral port', () => {
		expect(loadOperatorConfig(env({ IDP_OPERATOR_PORT: '4999' })).port).toBe(4999);
		expect(loadOperatorConfig(env({ IDP_OPERATOR_PORT: '0' })).port).toBe(0);
	});

	it.each([
		['IDP_CONTROL_URL', { IDP_CONTROL_URL: undefined }],
		['IDP_CONTROL_URL', { IDP_CONTROL_URL: '' }],
		['IDP_CONTROL_URL', { IDP_CONTROL_URL: 'not a url' }],
		['IDP_CONTROL_URL', { IDP_CONTROL_URL: 'file:///etc/passwd' }],
		['IDP_CONTROL_TOKEN', { IDP_CONTROL_TOKEN: undefined }],
		['IDP_CONTROL_TOKEN', { IDP_CONTROL_TOKEN: '   ' }],
		['IDP_OPERATOR_PORT', { IDP_OPERATOR_PORT: 'abc' }],
		['IDP_OPERATOR_PORT', { IDP_OPERATOR_PORT: '70000' }],
		['IDP_OPERATOR_PORT', { IDP_OPERATOR_PORT: '-1' }],
		['IDP_OPERATOR_PORT', { IDP_OPERATOR_PORT: '4030.5' }],
	])('rejects a missing or invalid %s with a typed error', (variable, overrides) => {
		let caught: unknown;
		try {
			loadOperatorConfig(env(overrides));
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(OperatorConfigError);
		expect((caught as OperatorConfigError).code).toBe('OPERATOR_CONFIG');
		expect((caught as OperatorConfigError).variable).toBe(variable);
	});

	it('never puts the token in an error message', () => {
		expect(() => loadOperatorConfig(env({ IDP_CONTROL_URL: TOKEN }))).toThrow(OperatorConfigError);
		try {
			loadOperatorConfig(env({ IDP_CONTROL_URL: TOKEN }));
		} catch (error) {
			expect(String(error)).not.toContain(TOKEN);
		}
	});
});
