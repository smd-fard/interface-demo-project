import type { PolicyConfig } from '@idp/artifact-schema';
import { DEFAULT_REDACTION_CONFIG } from '@idp/policy';

/**
 * The policy of `config/policy.json` with `${MOCKBANK_ORIGIN}` expanded to `origin`: every mock-bank route but
 * the admin and health endpoints, all eight action kinds, the irreversible Confirm/Submit/… controls and the
 * `/subaccount/opened` commit endpoint (the Review page's Confirm form posts there; Continue only posts to the
 * review page `/subaccount/confirm`, which is reversible). `exclude` adds route globs to exclude (e.g. to deny one screen in a test).
 */
export function mockBankPolicyConfig(
	origin: string,
	options: { readonly exclude?: readonly string[] } = {},
): PolicyConfig {
	return {
		version: '1.0.0',
		allow: {
			origins: [origin],
			routes: [{ origin, include: ['/**'], exclude: ['/__admin/**', '/__health', ...(options.exclude ?? [])] }],
			actions: ['navigate', 'click', 'fill', 'select', 'press', 'extract', 'wait', 'dismiss_dialog'],
		},
		irreversible: {
			controlNamePatterns: ['^Confirm$', '^Submit$', 'Open Account', 'Transfer', 'Delete', 'cannot be undone'],
			routes: ['/subaccount/opened'],
		},
		redaction: {
			patterns: DEFAULT_REDACTION_CONFIG.patterns.map((pattern) => ({ ...pattern })),
			terms: [...DEFAULT_REDACTION_CONFIG.terms],
		},
		approval: { expiresMs: 300_000 },
	};
}
