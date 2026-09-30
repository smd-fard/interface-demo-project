import { describe, expect, it } from 'vitest';
import { BANK, fixturePolicyConfig } from '../../test/fixtures/policyConfig.js';
import { resolvePolicy } from '../config/resolvePolicy.js';
import { evaluateLanding } from './evaluateLanding.js';

const policy = resolvePolicy(fixturePolicyConfig());

describe('evaluateLanding', () => {
	it('allows a landing URL on an allowed origin and route (query ignored)', () => {
		expect(evaluateLanding(`${BANK}/member/detail?id=1`, policy)).toEqual({ kind: 'allow' });
	});

	it('denies a click that landed off the allowlisted origins', () => {
		expect(evaluateLanding('https://example.com/phish', policy)).toMatchObject({
			kind: 'deny',
			code: 'origin_not_allowed',
		});
		expect(evaluateLanding('about:blank', policy)).toMatchObject({ kind: 'deny', code: 'origin_not_allowed' });
	});

	it('denies a landing on an excluded route', () => {
		expect(evaluateLanding(`${BANK}/__admin/faults`, policy)).toMatchObject({
			kind: 'deny',
			code: 'route_not_allowed',
		});
	});
});
