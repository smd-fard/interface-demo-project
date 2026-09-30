import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ACTION_KINDS } from '../step/ActionKind.js';
import { PolicyConfigSchema } from './PolicyConfig.js';

const envRule = { origin: '${MOCKBANK_ORIGIN}', include: ['/**'], exclude: ['/__admin/**'] };

const config = {
	version: '1.0.0',
	allow: {
		origins: ['${MOCKBANK_ORIGIN}', 'http://127.0.0.1:4010'],
		routes: [envRule, { origin: 'http://127.0.0.1:4010', include: ['/', '/login', '/member/**'], exclude: [] }],
		actions: [...ACTION_KINDS],
	},
	irreversible: {
		controlNamePatterns: ['^(Confirm|Submit|Post|Approve)\\b', 'Open Account'],
		routes: ['/subaccount/confirm'],
	},
	redaction: {
		patterns: [
			{ name: 'ssn', regex: '\\b\\d{3}-\\d{2}-\\d{4}\\b', mask: 'full' },
			{ name: 'account-number', regex: '\\b\\d{10,12}\\b', mask: 'keep_last_4' },
			{ name: 'member_number', regex: '\\b\\d{5}\\b', mask: 'keep_last_2' },
		],
		terms: ['Jane Sample', 'John Example'],
	},
	approval: { expiresMs: 300_000 },
};

describe('PolicyConfigSchema', () => {
	it('accepts a config with env-token and URL origins', () => {
		expect(PolicyConfigSchema.parse(config)).toEqual(config);
	});

	it('rejects a missing field', () => {
		const missing: Record<string, unknown> = { ...config };
		delete missing.approval;
		const result = PolicyConfigSchema.safeParse(missing);
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['approval']);
	});

	it('requires exclude on every route rule, so admin routes can be denied explicitly', () => {
		const noExclude: Record<string, unknown> = { ...config.allow.routes[0] };
		delete noExclude.exclude;
		const result = PolicyConfigSchema.safeParse({ ...config, allow: { ...config.allow, routes: [noExclude] } });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['allow', 'routes', 0, 'exclude']);
	});

	it('rejects an unknown key such as a raw secret', () => {
		expect(PolicyConfigSchema.safeParse({ ...config, adminPassword: 'hunter2' }).success).toBe(false);
		const allow = { ...config.allow, apiKey: 'sk-test' };
		expect(PolicyConfigSchema.safeParse({ ...config, allow }).success).toBe(false);
	});

	it.each(['127.0.0.1:4010', 'http://127.0.0.1:4010/member', '$ORIGIN', 'https://*.example.test'])(
		'rejects the origin %s',
		(origin) => {
			const result = PolicyConfigSchema.safeParse({ ...config, allow: { ...config.allow, origins: [origin] } });
			expect(result.success).toBe(false);
		},
	);

	it('rejects a route rule for an origin that is not allowed', () => {
		const routes = [{ origin: 'http://evil.example.test', include: ['/**'], exclude: [] }];
		const result = PolicyConfigSchema.safeParse({ ...config, allow: { ...config.allow, routes } });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['allow', 'routes', 0, 'origin']);
	});

	it.each(['member/**', 'http://host/x', '/a b', ''])('rejects the route glob %j', (glob) => {
		const routes = [{ ...envRule, include: [glob] }];
		expect(PolicyConfigSchema.safeParse({ ...config, allow: { ...config.allow, routes } }).success).toBe(false);
		expect(
			PolicyConfigSchema.safeParse({ ...config, irreversible: { ...config.irreversible, routes: [glob] } }).success,
		).toBe(false);
	});

	it('rejects an unknown action kind and duplicate actions or origins', () => {
		const unknown = PolicyConfigSchema.safeParse({ ...config, allow: { ...config.allow, actions: ['eval_js'] } });
		expect(unknown.success).toBe(false);
		const dupAction = PolicyConfigSchema.safeParse({
			...config,
			allow: { ...config.allow, actions: ['click', 'click'] },
		});
		expect(dupAction.error?.issues[0]?.path).toEqual(['allow', 'actions', 1]);
		const dupOrigin = PolicyConfigSchema.safeParse({
			...config,
			allow: { ...config.allow, origins: ['http://127.0.0.1:4010', 'http://127.0.0.1:4010'], routes: [] },
		});
		expect(dupOrigin.error?.issues[0]?.path).toEqual(['allow', 'origins', 1]);
	});

	it('rejects a control-name pattern that does not compile', () => {
		const result = PolicyConfigSchema.safeParse({
			...config,
			irreversible: { ...config.irreversible, controlNamePatterns: ['(Confirm'] },
		});
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['irreversible', 'controlNamePatterns', 0]);
	});

	it('rejects a redaction pattern that does not compile, matches the empty string, or has an unknown mask', () => {
		const withPattern = (pattern: object) => ({ ...config, redaction: { ...config.redaction, patterns: [pattern] } });
		const bad = PolicyConfigSchema.safeParse(withPattern({ name: 'x', regex: '[0-9', mask: 'full' }));
		expect(bad.error?.issues[0]?.path).toEqual(['redaction', 'patterns', 0, 'regex']);
		const empty = PolicyConfigSchema.safeParse(withPattern({ name: 'x', regex: '\\d*', mask: 'full' }));
		expect(empty.error?.issues[0]?.path).toEqual(['redaction', 'patterns', 0, 'regex']);
		expect(PolicyConfigSchema.safeParse(withPattern({ name: 'x', regex: '\\d+', mask: 'hash' })).success).toBe(false);
	});

	it('rejects duplicate redaction pattern names and too-short terms', () => {
		const patterns = [config.redaction.patterns[0], config.redaction.patterns[0]];
		const dup = PolicyConfigSchema.safeParse({ ...config, redaction: { ...config.redaction, patterns } });
		expect(dup.error?.issues[0]?.path).toEqual(['redaction', 'patterns', 1, 'name']);
		expect(PolicyConfigSchema.safeParse({ ...config, redaction: { ...config.redaction, terms: ['J'] } }).success).toBe(
			false,
		);
	});

	it('bounds approval.expiresMs', () => {
		expect(PolicyConfigSchema.safeParse({ ...config, approval: { expiresMs: 0 } }).success).toBe(false);
		expect(PolicyConfigSchema.safeParse({ ...config, approval: { expiresMs: 1.5 } }).success).toBe(false);
	});

	it('exports to JSON Schema', () => {
		expect(() => z.toJSONSchema(PolicyConfigSchema)).not.toThrow();
	});
});
