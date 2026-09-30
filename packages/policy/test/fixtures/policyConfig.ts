import type { PolicyConfig } from '@idp/artifact-schema';

/** The mock-bank origin the fixtures allow. Synthetic: a loopback address, never a real bank. */
export const BANK = 'http://127.0.0.1:4010';

/** A policy config shaped like config/policy.json (already env-expanded). Synthetic data only. */
export function fixturePolicyConfig(overrides: Partial<PolicyConfig> = {}): PolicyConfig {
	return {
		version: '1.0.0',
		allow: {
			origins: [BANK],
			routes: [{ origin: BANK, include: ['/**'], exclude: ['/__admin/**'] }],
			actions: ['navigate', 'click', 'fill', 'select', 'press', 'extract', 'wait', 'dismiss_dialog'],
		},
		irreversible: {
			controlNamePatterns: ['^Confirm$', '^Submit$', 'Open Account', 'Transfer', 'Delete'],
			routes: ['/subaccount/confirm'],
		},
		redaction: {
			patterns: [
				{ name: 'ssn', regex: '\\b\\d{3}-\\d{2}-\\d{4}\\b', mask: 'full' },
				{ name: 'account-number', regex: '(?<![\\d.,])\\d{10}(?!\\d|[.,]\\d)', mask: 'keep_last_4' },
				{ name: 'member-number', regex: '(?<![\\d.,])\\d{5}(?!\\d|[.,]\\d)', mask: 'keep_last_2' },
				{
					name: 'money-amount',
					regex: '(?<![\\w.,])(?:-\\$?|\\$-?)?(?:\\d{1,3}(?:,\\d{3})+|\\d+)\\.\\d{2}(?!\\w|[.,]\\d)',
					mask: 'full',
				},
			],
			terms: ['Jane Sample', 'John Placeholder', 'Ada Fixture'],
		},
		approval: { expiresMs: 300_000 },
		...overrides,
	};
}
