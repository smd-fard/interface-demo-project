import { describe, expect, it } from 'vitest';
import { valueSchemaFor } from './valueSchemaFor.js';

describe('valueSchemaFor', () => {
	it('string: full-match pattern and length bounds', () => {
		const schema = valueSchemaFor({ kind: 'string', pattern: '\\d{5}', maxLength: 5 }, { coerce: false });
		expect(schema.parse('12345')).toBe('12345');
		expect(schema.safeParse('x12345').success).toBe(false); // pattern is anchored
		expect(schema.safeParse('123456').success).toBe(false);
	});

	it('integer: numbers, and digit strings only when coercing', () => {
		const type = { kind: 'integer', min: 1, max: 10 } as const;
		expect(valueSchemaFor(type, { coerce: true }).parse('7')).toBe(7);
		expect(valueSchemaFor(type, { coerce: true }).parse(7)).toBe(7);
		expect(valueSchemaFor(type, { coerce: true }).safeParse('7.5').success).toBe(false);
		expect(valueSchemaFor(type, { coerce: true }).safeParse('11').success).toBe(false);
		expect(valueSchemaFor(type, { coerce: false }).safeParse('7').success).toBe(false);
	});

	it('decimal: digit strings with at most `scale` fractional digits, never numbers', () => {
		const schema = valueSchemaFor({ kind: 'decimal', scale: 2 }, { coerce: true });
		expect(schema.parse('1234.56')).toBe('1234.56');
		expect(schema.parse('-3')).toBe('-3');
		expect(schema.parse('0.5')).toBe('0.5');
		expect(schema.safeParse('1.234').success).toBe(false);
		expect(schema.safeParse('1,234.56').success).toBe(false);
		expect(schema.safeParse(1234.56).success).toBe(false);
		expect(valueSchemaFor({ kind: 'decimal', scale: 0 }, { coerce: false }).safeParse('1.0').success).toBe(false);
	});

	it('boolean: booleans, and "true"/"false" when coercing', () => {
		expect(valueSchemaFor({ kind: 'boolean' }, { coerce: true }).parse('false')).toBe(false);
		expect(valueSchemaFor({ kind: 'boolean' }, { coerce: true }).parse(true)).toBe(true);
		expect(valueSchemaFor({ kind: 'boolean' }, { coerce: true }).safeParse('yes').success).toBe(false);
		expect(valueSchemaFor({ kind: 'boolean' }, { coerce: false }).safeParse('true').success).toBe(false);
	});

	it('enum and date', () => {
		const e = valueSchemaFor({ kind: 'enum', values: ['a', 'b'] }, { coerce: false });
		expect(e.parse('a')).toBe('a');
		expect(e.safeParse('c').success).toBe(false);
		const d = valueSchemaFor({ kind: 'date' }, { coerce: false });
		expect(d.parse('2026-09-29')).toBe('2026-09-29');
		expect(d.safeParse('2026-13-01').success).toBe(false);
		expect(d.safeParse('29/09/2026').success).toBe(false);
	});
});
