import type { RedactionConfig } from './RedactionConfig.js';

/** Version of the default redaction rules. Bump it whenever a default pattern, mask or term changes. */
export const REDACTION_RULES_VERSION = '1.2.0';

/**
 * The default redaction rules (the same rules `config/policy.json` ships). The number patterns refuse to match
 * inside a decimal amount: they reject a digit, "." or "," before, and a digit or a "."/"," followed by a digit
 * after — so a balance such as `12345.67` or `12,345.67` is never partially masked as a member number.
 *
 * `money-amount` (since 1.1.0) masks a currency-like amount whole: exactly 2 fractional digits, optional
 * thousands separators and an optional leading `-` / `$` (`842.10`, `1,523.47`, `$10,250.00`, `-3.00`). Balances
 * are regulated financial data and the model never needs their digits (`extract` reads them off the surface).
 * It rejects a word character, "." or "," before, and a word character or a "."/"," followed by a digit after,
 * so versions (`7.4`, `1.0.1`, `1.10.12`), IPs and ports, integers, ISO timestamps, `1.25s` and hex never match.
 *
 * 1.2.0 changes how the rules apply, not the rules themselves (`createRedactor`): hex digests (`sha256:<64 hex>`
 * and standalone runs of 32+ hex characters) and URL authorities (`http://127.0.0.1:61012`) are exempt from
 * patterns and terms, and a name-like known value
 * matches case-insensitively at word boundaries.
 */
export const DEFAULT_REDACTION_CONFIG: RedactionConfig = Object.freeze({
	patterns: Object.freeze([
		Object.freeze({ name: 'ssn', regex: String.raw`\b\d{3}-\d{2}-\d{4}\b`, mask: 'full' as const }),
		Object.freeze({
			name: 'account-number',
			regex: String.raw`(?<![\d.,])\d{10}(?!\d|[.,]\d)`,
			mask: 'keep_last_4' as const,
		}),
		Object.freeze({
			name: 'member-number',
			regex: String.raw`(?<![\d.,])\d{5}(?!\d|[.,]\d)`,
			mask: 'keep_last_2' as const,
		}),
		Object.freeze({
			name: 'money-amount',
			regex: String.raw`(?<![\w.,])(?:-\$?|\$-?)?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}(?!\w|[.,]\d)`,
			mask: 'full' as const,
		}),
	]),
	// The synthetic member names of the mock bank. Never real people.
	terms: Object.freeze(['Jane Sample', 'John Placeholder', 'Ada Fixture']),
}) as RedactionConfig;
