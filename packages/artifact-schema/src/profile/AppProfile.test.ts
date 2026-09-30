import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppProfileSchema } from './AppProfile.js';

const profile = {
	app: { vendorApp: 'coreone', appVersion: 'CoreOne 7.4' },
	variant: 'tenant-a',
	origin: '${MOCKBANK_ORIGIN}',
	loginRoute: '/',
	credentialRef: 'mockbank-operator',
	conditions: [
		{
			code: 'permission_denied',
			class: 'business_outcome',
			description: 'The operator lacks the entitlement for this function.',
			signature: { kind: 'text_present', text: 'SEC-403' },
			scope: 'any_step',
		},
		{
			code: 'session_timeout',
			class: 'recoverable',
			description: 'The session expired and the app shows the Sign On page again.',
			signature: { kind: 'text_present', text: 'Your session has expired' },
			scope: 'any_step',
			recovery: { kind: 'reauth' },
		},
	],
	knownDialogs: [
		{
			code: 'known_dialog',
			description: 'Maintenance notice raised when member detail loads.',
			text: 'Scheduled maintenance',
			action: 'accept',
		},
	],
};

describe('AppProfileSchema', () => {
	it('accepts a profile with an env-token origin', () => {
		expect(AppProfileSchema.parse(profile)).toEqual(profile);
	});

	it.each(['http://127.0.0.1:4010', 'https://coreone.example.test'])('accepts the URL origin %s', (origin) => {
		expect(AppProfileSchema.parse({ ...profile, origin }).origin).toBe(origin);
	});

	it.each(['127.0.0.1:4010', 'http://127.0.0.1:4010/', 'http://host/path', '${lowercase}', '$MOCKBANK_ORIGIN'])(
		'rejects the origin %s',
		(origin) => {
			const result = AppProfileSchema.safeParse({ ...profile, origin });
			expect(result.success).toBe(false);
			expect(result.error?.issues[0]?.path).toEqual(['origin']);
		},
	);

	it('rejects a default condition scoped to step ids (a profile has no steps)', () => {
		const result = AppProfileSchema.safeParse({
			...profile,
			conditions: [{ ...profile.conditions[0], scope: ['s06-click-search'] }],
		});
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['conditions', 0, 'scope']);
	});

	it('rejects duplicate condition codes', () => {
		const result = AppProfileSchema.safeParse({
			...profile,
			conditions: [profile.conditions[0], profile.conditions[0]],
		});
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['conditions', 1, 'code']);
	});

	it('rejects a non-relative login route, a bad tenant id and an unknown extra key', () => {
		expect(AppProfileSchema.safeParse({ ...profile, loginRoute: 'login' }).success).toBe(false);
		expect(AppProfileSchema.safeParse({ ...profile, variant: 'Tenant A' }).success).toBe(false);
		expect(AppProfileSchema.safeParse({ ...profile, password: 'hunter2' }).success).toBe(false);
	});

	it('exports to JSON Schema', () => {
		expect(() => z.toJSONSchema(AppProfileSchema)).not.toThrow();
	});
});
