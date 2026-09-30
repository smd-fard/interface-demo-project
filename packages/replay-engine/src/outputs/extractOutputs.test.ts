import type { OutputSpec } from '@idp/artifact-schema';
import { describe, expect, it } from 'vitest';
import { ReplayError } from '../errors/ReplayError.js';
import { OutputParseError } from './OutputParseError.js';
import { extractOutputs, parseExtracted, type RawExtraction } from './extractOutputs.js';

const decimal2 = { kind: 'decimal', scale: 2 } as const;
const text = { kind: 'string', minLength: 1 } as const;

describe('parseExtracted', () => {
	it('decimal: removes separators and symbols and pads to the declared scale', () => {
		expect(parseExtracted('1,523.47', { kind: 'decimal' }, decimal2)).toBe('1523.47');
		expect(parseExtracted('$ 1,523.4', { kind: 'decimal' }, decimal2)).toBe('1523.40');
		expect(parseExtracted('842', { kind: 'decimal' }, decimal2)).toBe('842.00');
		expect(parseExtracted('(12.50)', { kind: 'decimal' }, decimal2)).toBe('-12.50');
		expect(parseExtracted('12.50-', { kind: 'decimal' }, decimal2)).toBe('-12.50');
		expect(parseExtracted('-0.5', { kind: 'decimal' }, decimal2)).toBe('-0.50');
	});

	it('decimal: keeps extra fractional digits (validation rejects them) and refuses non-numbers', () => {
		expect(parseExtracted('1.234', { kind: 'decimal' }, decimal2)).toBe('1.234');
		expect(() => parseExtracted('n/a', { kind: 'decimal' }, decimal2)).toThrow(OutputParseError);
		expect(() => parseExtracted('1.2.3', { kind: 'decimal' }, decimal2)).toThrow(OutputParseError);
	});

	it('integer: removes separators and returns a safe integer', () => {
		expect(parseExtracted('1,234', { kind: 'integer' }, { kind: 'integer' })).toBe(1234);
		expect(parseExtracted(' 7 ', { kind: 'integer' }, { kind: 'integer' })).toBe(7);
		expect(() => parseExtracted('seven', { kind: 'integer' }, { kind: 'integer' })).toThrow(OutputParseError);
		expect(() => parseExtracted('99999999999999999999', { kind: 'integer' }, { kind: 'integer' })).toThrow(
			OutputParseError,
		);
	});

	it('text: collapses whitespace', () => {
		expect(parseExtracted('  Jane \n  Sample ', { kind: 'text' }, text)).toBe('Jane Sample');
	});

	it('pattern: the first capture group, or the whole match without a group', () => {
		expect(parseExtracted('Balance: 1,523.47 USD', { kind: 'decimal', pattern: 'Balance: ([\\d,.]+)' }, decimal2)).toBe(
			'1523.47',
		);
		expect(parseExtracted('Confirmation # SA-000001', { kind: 'text', pattern: 'SA-\\d+' }, text)).toBe('SA-000001');
		expect(() => parseExtracted('nothing here', { kind: 'text', pattern: 'SA-\\d+' }, text)).toThrow(OutputParseError);
	});

	it('the parse error never echoes the raw text', () => {
		const error = (() => {
			try {
				parseExtracted('Jane Sample', { kind: 'integer' }, { kind: 'integer' });
			} catch (caught) {
				return caught as Error;
			}
			return undefined;
		})();
		expect(error).toBeInstanceOf(OutputParseError);
		expect(error?.message).not.toContain('Jane');
	});
});

describe('extractOutputs', () => {
	const specs: OutputSpec[] = [
		{ name: 'savingsBalance', description: 'Savings balance', type: decimal2, sensitive: true },
		{ name: 'memberName', description: 'Member name', type: text, sensitive: true },
	];
	const extraction = (raw: string, parse: RawExtraction['parse'], stepIndex: number, stepId: string) => ({
		raw,
		parse,
		stepIndex,
		stepId,
	});

	it('parses every extraction and validates the outputs', () => {
		const extractions = new Map<string, RawExtraction>([
			['savingsBalance', extraction('1,523.47', { kind: 'decimal' }, 6, 's07-extract-savings-balance')],
			['memberName', extraction('Jane Sample', { kind: 'text' }, 7, 's08-extract-member-name')],
		]);
		expect(extractOutputs(extractions, specs)).toEqual({ savingsBalance: '1523.47', memberName: 'Jane Sample' });
	});

	it('an output that fails its type is output_invalid at its extract step', () => {
		const extractions = new Map<string, RawExtraction>([
			['savingsBalance', extraction('1.234', { kind: 'decimal' }, 6, 's07-extract-savings-balance')],
			['memberName', extraction('Jane Sample', { kind: 'text' }, 7, 's08-extract-member-name')],
		]);
		const error = (() => {
			try {
				extractOutputs(extractions, specs);
			} catch (caught) {
				return caught;
			}
			return undefined;
		})();
		expect(error).toBeInstanceOf(ReplayError);
		expect(error).toMatchObject({
			code: 'output_invalid',
			step: { index: 6, id: 's07-extract-savings-balance' },
		});
	});

	it('an unparseable or missing output is output_invalid', () => {
		const unparseable = new Map<string, RawExtraction>([
			['savingsBalance', extraction('n/a', { kind: 'decimal' }, 6, 's07-extract-savings-balance')],
			['memberName', extraction('Jane Sample', { kind: 'text' }, 7, 's08-extract-member-name')],
		]);
		expect(() => extractOutputs(unparseable, specs)).toThrow(ReplayError);
		const missing = new Map<string, RawExtraction>([
			['memberName', extraction('Jane Sample', { kind: 'text' }, 7, 's08-extract-member-name')],
		]);
		let caught: unknown;
		try {
			extractOutputs(missing, specs);
		} catch (error) {
			caught = error;
		}
		expect(caught).toMatchObject({ code: 'output_invalid', step: null });
	});
});
