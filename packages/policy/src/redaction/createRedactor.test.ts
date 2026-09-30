import { describe, expect, it } from 'vitest';
import { fixturePolicyConfig } from '../../test/fixtures/policyConfig.js';
import { resolvePolicy } from '../config/resolvePolicy.js';
import { createRedactor } from './createRedactor.js';
import { DEFAULT_REDACTION_CONFIG } from './defaultRedactionRules.js';

const config = fixturePolicyConfig();
const FULL = '[REDACTED]';

function redactor() {
	return createRedactor({
		config,
		sensitiveValues: [{ value: 'M-00417', paramName: 'memberId' }, { value: 'hunter2-synthetic' }],
	});
}

describe('createRedactor', () => {
	it('masks a known sensitive value inside longer text', () => {
		expect(redactor().redactString('Searching for member M-00417 now')).toBe(`Searching for member ${FULL} now`);
		expect(redactor().redactString('pw=hunter2-synthetic;')).toBe(`pw=${FULL};`);
	});

	it('walks nested objects and arrays, masking values but never keys', () => {
		const input = {
			'M-00417': 'key is not a value',
			member: { id: 'M-00417', notes: ['SSN 123-45-6789', { account: '1234567890' }] },
			count: 3,
			ok: true,
			nothing: null,
		};
		expect(redactor().redact(input)).toEqual({
			'M-00417': 'key is not a value',
			member: { id: FULL, notes: [`SSN ${FULL}`, { account: '[•••7890]' }] },
			count: 3,
			ok: true,
			nothing: null,
		});
	});

	it('does not mutate its input', () => {
		const input = { id: 'M-00417' };
		redactor().redact(input);
		expect(input).toEqual({ id: 'M-00417' });
	});

	it('applies the config patterns with their mask styles', () => {
		const r = redactor();
		expect(r.redactString('ssn 123-45-6789')).toBe(`ssn ${FULL}`);
		expect(r.redactString('acct 1234567890')).toBe('acct [•••7890]');
		expect(r.redactString('member 48213.')).toBe('member [•••13].');
	});

	// Expectation changed with REDACTION_RULES_VERSION 1.1.0: balances used to be asserted *unmasked* (only
	// "not over-masked by the member-number pattern"). Money amounts are now regulated data, so a balance is
	// masked WHOLE by the money-amount rule — never partially by the member pattern (e.g. `[•••45].67`).
	it('masks a balance amount whole with the money-amount rule, never partially with the member-number pattern', () => {
		const r = redactor();
		for (const balance of ['12345.67', '1523.47', '12,345.67', '98765.00']) {
			const masked = r.redactString(`Balance: ${balance}`);
			expect(masked).toBe(`Balance: ${FULL}`);
			expect(masked).not.toMatch(/\[•••\d+\]|\d/);
		}
		expect(r.redactString('Balance: $ 98765.00')).toBe(`Balance: $ ${FULL}`);
		// A comma-decimal amount is outside the money-amount rule; the member pattern still must not split it.
		expect(r.redactString('Balance: -54321,10')).toBe('Balance: -54321,10');
		expect(r.redact({ balance: 12345.67 })).toEqual({ balance: FULL });
	});

	describe('money-amount rule', () => {
		const amounts = ['842.10', '1523.47', '1,523.47', '$10,250.00', '12.35', '-3.00', '-$3.00', '$-3.00'];

		it.each(amounts)('masks %s whole (redact)', (amount) => {
			expect(redactor().redactString(`Checking ${amount} available`)).toBe(`Checking ${FULL} available`);
			expect(redactor().redact({ cell: amount })).toEqual({ cell: FULL });
		});

		it.each(amounts)('masks %s whole (placeholderize)', (amount) => {
			expect(redactor().placeholderize(`Share Savings ${amount}`)).toBe(`Share Savings ${FULL}`);
		});

		it('masks an amount in a table cell and at the end of a sentence', () => {
			expect(redactor().redactString('Checking 842.10\nShare Savings 1,523.47.')).toBe(
				`Checking ${FULL}\nShare Savings ${FULL}.`,
			);
		});

		it.each([
			['a version', 'CoreOne 7.4'],
			['a semver', 'schemaVersion 1.0.1'],
			['a dotted version with 2-digit parts', 'build 1.10.12'],
			['an IP and port', 'http://127.0.0.1:4010/member'],
			['an IP with 2-digit octets', 'host 192.168.10.25'],
			['an integer duration', 'durationMs 1523'],
			['an ISO timestamp', '2026-09-29T12:34:56.789Z'],
			['a 3-decimal number', 'ratio 12.345'],
			['a sha256', 'sha256 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'],
			['an Oracle error code', 'ORA-06512: at line 1'],
			['a sub-account id', 'SA-000001'],
			['a number with a unit suffix', 'took 1.25s'],
		])('leaves %s untouched', (_label, text) => {
			const r = createRedactor({ config: { redaction: DEFAULT_REDACTION_CONFIG }, sensitiveValues: [] });
			const moneyOnly = createRedactor({
				config: {
					redaction: {
						patterns: DEFAULT_REDACTION_CONFIG.patterns.filter((p) => p.name === 'money-amount'),
						terms: [],
					},
				},
				sensitiveValues: [],
			});
			expect(moneyOnly.redactString(text)).toBe(text);
			expect(moneyOnly.placeholderize(text)).toBe(text);
			// The full default rules may mask other things (e.g. ORA-06512 as a member number), never an amount.
			expect(r.redactString(text)).not.toContain(`${FULL}.`);
		});

		it('is idempotent and never re-matches its own mask', () => {
			const r = redactor();
			const once = r.redactString('Checking 842.10, $10,250.00, -3.00');
			expect(once).toBe(`Checking ${FULL}, ${FULL}, ${FULL}`);
			expect(r.redactString(once)).toBe(once);
			expect(r.placeholderize(once)).toBe(once);
		});
	});

	it('masks the synthetic names as terms, case- and whitespace-insensitively', () => {
		const r = redactor();
		expect(r.redactString('Owner: Jane Sample, joint: john  placeholder')).toBe(`Owner: ${FULL}, joint: ${FULL}`);
		expect(r.redactString('Ada\nFixture')).toBe(FULL);
	});

	it('masks sensitive numbers as strings', () => {
		const r = createRedactor({ config, sensitiveValues: [4242] });
		expect(r.redact({ pin: 4242, other: 7 })).toEqual({ pin: FULL, other: 7 });
	});

	it('is idempotent: redacting twice equals redacting once', () => {
		const r = redactor();
		const input = {
			text: 'M-00417 / 123-45-6789 / 1234567890 / 48213 / Jane Sample / 1523.47',
			list: ['[REDACTED]', '[•••13]'],
		};
		const once = r.redact(input);
		expect(r.redact(once)).toEqual(once);
		const placeholdered = r.placeholderize(input);
		expect(r.placeholderize(placeholdered)).toEqual(placeholdered);
	});

	it('does not let a term mangle an existing mask', () => {
		const r = createRedactor({ config: { redaction: { patterns: [], terms: ['ACT', '13'] } }, sensitiveValues: [] });
		expect(r.redactString('[REDACTED] [•••13]')).toBe('[REDACTED] [•••13]');
	});

	it('placeholderizes known param values and redacts the rest (round trip)', () => {
		const r = redactor();
		const observation = 'Member M-00417 (Jane Sample), ssn 123-45-6789, pw hunter2-synthetic';
		const placeholdered = r.placeholderize(observation);
		expect(placeholdered).toBe(`Member {{memberId}} (${FULL}), ssn ${FULL}, pw ${FULL}`);
		// The model echoes the placeholder back; binding it restores the original param value.
		expect(placeholdered.replace('{{memberId}}', 'M-00417')).toContain('M-00417');
	});

	it('extends the sensitive set at run time', () => {
		const r = redactor();
		expect(r.redactString('balance owner token XK-77')).toBe('balance owner token XK-77');
		r.addSensitiveValue({ value: 'XK-77' });
		expect(r.redactString('balance owner token XK-77')).toBe(`balance owner token ${FULL}`);
		r.addSensitiveValue({ value: 'Q-9', paramName: 'code' });
		expect(r.placeholderize('code Q-9')).toBe('code {{code}}');
	});

	it('ignores sensitive values shorter than 2 characters', () => {
		const r = createRedactor({ config, sensitiveValues: ['a', ''] });
		expect(r.redactString('a banana')).toBe('a banana');
	});

	it('masks the longest known value first', () => {
		const r = createRedactor({ config, sensitiveValues: ['AB', 'ABCD', 'X1', 'X1Y2'] });
		// Alphabetic values match at word boundaries since rules 1.2.0, so the text separates them.
		expect(r.redactString('x ABCD x')).toBe(`x ${FULL} x`);
		expect(r.redactString('zX1Y2z')).toBe(`z${FULL}z`);
	});

	describe('digit boundaries on known values', () => {
		function numericRedactor() {
			return createRedactor({ config, sensitiveValues: [{ value: '12345', paramName: 'memberId' }] });
		}

		it('does not mask a known digit value embedded in a longer digit run (redact)', () => {
			// Masking only the substring would leak 5 of the 10 account digits and block the account pattern.
			expect(numericRedactor().redactString('acct 8800123450')).toBe('acct [•••3450]');
		});

		it('does not placeholderize a known digit value embedded in a longer digit run', () => {
			expect(numericRedactor().placeholderize('acct 8800123450')).toBe('acct [•••3450]');
			expect(numericRedactor().placeholderize({ account: '8800123450' })).toEqual({ account: '[•••3450]' });
		});

		it('still matches a standalone known digit value', () => {
			const r = numericRedactor();
			expect(r.placeholderize('Member # 12345')).toBe('Member # {{memberId}}');
			expect(r.placeholderize('/member?m=12345&x=1')).toBe('/member?m={{memberId}}&x=1');
			expect(r.placeholderize('Found member 12345.')).toBe('Found member {{memberId}}.');
			expect(r.redactString('Member # 12345')).toBe(`Member # ${FULL}`);
			expect(r.redactString('m=12345&')).toBe(`m=${FULL}&`);
			expect(r.redactString('Found member 12345.')).toBe(`Found member ${FULL}.`);
		});

		it('matches a known decimal value whole, but not inside a longer number', () => {
			const r = createRedactor({ config, sensitiveValues: ['1523.47'] });
			expect(r.redactString('Balance: 1523.47')).toBe(`Balance: ${FULL}`);
			expect(r.redactString('Balance: 11523.470')).toBe('Balance: 11523.470');
		});

		// Expectation changed with rules 1.2.0: a name-like value (`Smith`) no longer matches inside a word
		// (it used to turn `Smithson` into `[REDACTED]son`); a mixed value (`AB12`) keeps substring matching.
		it('keeps letter edges of a mixed value matching inside longer text, but not a name-like value', () => {
			const r = createRedactor({ config, sensitiveValues: ['AB12', 'Smith'] });
			expect(r.redactString('xAB12y Smithson Smith')).toBe(`x${FULL}y Smithson ${FULL}`);
		});

		it('escapes regex metacharacters in known values with digit edges', () => {
			const r = createRedactor({ config, sensitiveValues: ['1.5+2', '9(9)9'] });
			expect(r.redactString('a 1.5+2 b 9(9)9 c')).toBe(`a ${FULL} b ${FULL} c`);
			expect(r.redactString('1x5+2 9999')).toBe('1x5+2 9999');
			expect(r.redactString('11.5+2')).toBe('11.5+2');
		});
	});

	it('handles cycles, Errors and Dates without throwing', () => {
		const r = redactor();
		const cyclic: Record<string, unknown> = { id: 'M-00417' };
		cyclic['self'] = cyclic;
		const out = r.redact(cyclic) as Record<string, unknown>;
		expect(out['id']).toBe(FULL);
		expect(out['self']).toBe('[Circular]');
		const error = r.redact(new Error('lookup failed for M-00417')) as unknown as { message: string };
		expect(error.message).toBe(`lookup failed for ${FULL}`);
		const date = new Date(0);
		expect(r.redact({ at: date })).toEqual({ at: date });
	});

	it('replaces binary payloads, which cannot be scanned, with a mask', () => {
		expect(redactor().redact({ bytes: new Uint8Array([1, 2]) })).toEqual({ bytes: FULL });
	});

	it('accepts a ResolvedPolicy as its config, and uses the defaults when none is given', () => {
		const fromPolicy = createRedactor({ config: resolvePolicy(config), sensitiveValues: [] });
		expect(fromPolicy.redactString('Jane Sample')).toBe(FULL);
		const defaults = createRedactor({ sensitiveValues: [] });
		// Since rules 1.1.0 the default money-amount rule masks the balance too (it used to stay in clear).
		expect(defaults.redactString('123-45-6789 Ada Fixture 12345.67')).toBe(`${FULL} ${FULL} ${FULL}`);
		expect(DEFAULT_REDACTION_CONFIG.patterns.map((pattern) => pattern.name)).toEqual([
			'ssn',
			'account-number',
			'member-number',
			'money-amount',
		]);
	});

	describe('alphabetic known values (rules 1.2.0)', () => {
		it('matches case-insensitively', () => {
			const r = createRedactor({ config, sensitiveValues: [{ value: 'Ann', paramName: 'firstName' }] });
			expect(r.redactString('ANN / ann / Ann')).toBe(`${FULL} / ${FULL} / ${FULL}`);
			expect(r.placeholderize('Hello ANN.')).toBe('Hello {{firstName}}.');
		});

		it('matches only at word boundaries, so a short name never splits a longer word', () => {
			const r = createRedactor({ config, sensitiveValues: ['Ann'] });
			expect(r.redactString('Annual fee for Joanne, Ann2')).toBe('Annual fee for Joanne, Ann2');
			expect(r.redactString('(Ann)')).toBe(`(${FULL})`);
		});

		it('matches a multi-word name across case', () => {
			const r = createRedactor({ config, sensitiveValues: ['Mary Example'] });
			expect(r.redactString('Owner: MARY EXAMPLE')).toBe(`Owner: ${FULL}`);
		});

		it('keeps case-sensitive substring matching for a non-alphabetic value (e.g. a password)', () => {
			const r = createRedactor({ config, sensitiveValues: ['hunter2-synthetic'] });
			expect(r.redactString('xhunter2-syntheticx')).toBe(`x${FULL}x`);
			expect(r.redactString('HUNTER2-SYNTHETIC')).toBe('HUNTER2-SYNTHETIC');
		});
	});

	describe('hex digests and URL authorities (rules 1.2.0)', () => {
		const digest = 'sha256:5899f68e40f1234567890abcdef12345abcdef0123456789abcdef0123456745';
		const bareHex = '0123456789abcdef0123456789abcdef';

		it('leaves a sha256 digest intact under the default patterns', () => {
			const r = createRedactor({ sensitiveValues: [] });
			expect(r.redactString(`screen ${digest} changed`)).toBe(`screen ${digest} changed`);
			expect(r.redact({ before: digest })).toEqual({ before: digest });
			expect(r.placeholderize(digest)).toBe(digest);
		});

		it('leaves a truncated run-log digest intact (was sha256:5899f68e40f[•••45])', () => {
			const r = createRedactor({ sensitiveValues: [] });
			expect(r.redactString('sha256:5899f68e40f12345')).toBe('sha256:5899f68e40f12345');
			expect(r.redact({ kind: 'observation', digest: 'sha256:0000012345abcdef' })).toEqual({
				kind: 'observation',
				digest: 'sha256:0000012345abcdef',
			});
		});

		it('leaves a standalone run of 32+ hex characters intact, but a short hex run is not exempt', () => {
			const r = createRedactor({ sensitiveValues: [] });
			expect(r.redactString(`id ${bareHex}`)).toBe(`id ${bareHex}`);
			expect(r.redactString('id abc12345')).toBe('id abc[•••45]');
			expect(r.redactString('member 48213')).toBe('member [•••13]');
		});

		it('still masks a known sensitive value inside a digest', () => {
			const r = createRedactor({ sensitiveValues: ['5899f68e40f'] });
			expect(r.redactString(digest)).not.toContain('5899f68e40f');
		});

		it('leaves the port of a URL authority intact, but still masks a member number in its path or query', () => {
			const r = createRedactor({ sensitiveValues: [] });
			expect(r.redactString('control API at http://127.0.0.1:61012')).toBe('control API at http://127.0.0.1:61012');
			expect(r.redactString('http://localhost:43210/member?m=48213')).toBe('http://localhost:43210/member?m=[•••13]');
			expect(r.redactString('port 61012')).toBe('port [•••12]');
			// A known value is masked even inside an authority.
			expect(createRedactor({ sensitiveValues: ['61012'] }).redactString('http://127.0.0.1:61012')).toBe(
				`http://127.0.0.1:${FULL}`,
			);
		});

		it('does not exempt an all-digit run, a digit-only host or userinfo', () => {
			const digits = '12345678901234567890123456789012345';
			const termed = createRedactor({ config: { redaction: { patterns: [], terms: [digits] } }, sensitiveValues: [] });
			expect(termed.redactString(`ref ${digits}`)).not.toContain(digits);
			const r = createRedactor({ sensitiveValues: [] });
			expect(r.redactString('http://48213/')).toBe('http://[•••13]/');
			expect(r.redactString('http://u:48213@bank.example/')).not.toContain('48213');
		});

		it('exempts digests from terms too', () => {
			const r = createRedactor({ config: { redaction: { patterns: [], terms: ['abcdef'] } }, sensitiveValues: [] });
			expect(r.redactString(digest)).toBe(digest);
			expect(r.redactString('abcdef')).toBe(FULL);
		});
	});
});
