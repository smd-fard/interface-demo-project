import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PolicyConfigSchema } from '@idp/artifact-schema';
import { describe, expect, it } from 'vitest';
import { fixturePolicyConfig } from '../../test/fixtures/policyConfig.js';
import { DEFAULT_REDACTION_CONFIG, REDACTION_RULES_VERSION } from './defaultRedactionRules.js';

describe('defaultRedactionRules', () => {
	it('is versioned and valid as the redaction section of a PolicyConfig', () => {
		expect(REDACTION_RULES_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
		expect(PolicyConfigSchema.safeParse(fixturePolicyConfig({ redaction: DEFAULT_REDACTION_CONFIG })).success).toBe(
			true,
		);
	});

	it('ships the money-amount rule (full mask) since rules version 1.1.0', () => {
		expect(REDACTION_RULES_VERSION).toBe('1.1.0');
		expect(DEFAULT_REDACTION_CONFIG.patterns.map((pattern) => pattern.name)).toEqual([
			'ssn',
			'account-number',
			'member-number',
			'money-amount',
		]);
		expect(DEFAULT_REDACTION_CONFIG.patterns.find((pattern) => pattern.name === 'money-amount')?.mask).toBe('full');
	});

	it('matches config/policy.json (the defaults and the shipped config stay in step)', () => {
		const shipped = JSON.parse(
			readFileSync(fileURLToPath(new URL('../../../../config/policy.json', import.meta.url)), 'utf8'),
		) as unknown;
		const parsed = PolicyConfigSchema.parse(shipped);
		expect(parsed.redaction).toEqual(DEFAULT_REDACTION_CONFIG);
	});

	it('includes the synthetic mock-bank names as terms', () => {
		expect(DEFAULT_REDACTION_CONFIG.terms).toEqual(
			expect.arrayContaining(['Jane Sample', 'John Placeholder', 'Ada Fixture']),
		);
	});
});
