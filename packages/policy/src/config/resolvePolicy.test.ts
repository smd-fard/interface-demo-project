import { describe, expect, it } from 'vitest';
import { BANK, fixturePolicyConfig } from '../../test/fixtures/policyConfig.js';
import { PolicyConfigError } from '../errors/PolicyConfigError.js';
import { resolvePolicy } from './resolvePolicy.js';

describe('resolvePolicy', () => {
	it('compiles origins, actions and route matchers', () => {
		const policy = resolvePolicy(fixturePolicyConfig());
		expect(policy.version).toBe('1.0.0');
		expect(policy.origins.has(BANK)).toBe(true);
		expect(policy.actions.has('click')).toBe(true);
		expect(policy.isRouteAllowed(BANK, '/member/search')).toBe(true);
		expect(policy.isRouteAllowed(BANK, '/')).toBe(true);
		expect(policy.approvalExpiresMs).toBe(300_000);
	});

	it('lets exclude beat include', () => {
		const policy = resolvePolicy(fixturePolicyConfig());
		expect(policy.isRouteAllowed(BANK, '/__admin/faults')).toBe(false);
		expect(policy.isRouteAllowed(BANK, '/__admin')).toBe(false);
	});

	it('denies a route on an origin that has no route rule', () => {
		const other = 'http://127.0.0.1:4011';
		const config = fixturePolicyConfig();
		const policy = resolvePolicy({ ...config, allow: { ...config.allow, origins: [BANK, other] } });
		expect(policy.isRouteAllowed(other, '/member')).toBe(false);
	});

	it('normalizes origins (case, default port)', () => {
		const config = fixturePolicyConfig();
		const policy = resolvePolicy({
			...config,
			allow: { ...config.allow, origins: ['HTTP://Bank.Example.test:80'], routes: [] },
		});
		expect(policy.origins.has('http://bank.example.test')).toBe(true);
	});

	it('throws a typed error when an ${ENV} token was not expanded', () => {
		const config = fixturePolicyConfig();
		const call = () => resolvePolicy({ ...config, allow: { ...config.allow, origins: ['${MOCKBANK_ORIGIN}'] } });
		expect(call).toThrow(PolicyConfigError);
		try {
			call();
		} catch (error) {
			expect((error as PolicyConfigError).code).toBe('unexpanded_env_token');
		}
	});

	it('throws a typed error for an invalid control-name regex', () => {
		const config = fixturePolicyConfig({ irreversible: { controlNamePatterns: ['('], routes: [] } });
		expect(() => resolvePolicy(config)).toThrow(expect.objectContaining({ code: 'invalid_regex' }));
	});

	it('returns a frozen object', () => {
		expect(Object.isFrozen(resolvePolicy(fixturePolicyConfig()))).toBe(true);
	});
});
