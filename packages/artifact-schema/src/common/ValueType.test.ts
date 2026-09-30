import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ValueTypeSchema } from './ValueType.js';

describe('ValueTypeSchema', () => {
	it.each([
		{ kind: 'string' },
		{ kind: 'string', pattern: '\\d{5}', minLength: 5, maxLength: 5 },
		{ kind: 'integer', min: 0, max: 100 },
		{ kind: 'decimal', scale: 2 },
		{ kind: 'boolean' },
		{ kind: 'enum', values: ['checking', 'savings'] },
		{ kind: 'date' },
	])('accepts %j', (value) => {
		expect(ValueTypeSchema.parse(value)).toEqual(value);
	});

	it('rejects an unknown kind', () => {
		expect(ValueTypeSchema.safeParse({ kind: 'money' }).success).toBe(false);
	});

	it('rejects an unknown extra key (strict)', () => {
		const result = ValueTypeSchema.safeParse({ kind: 'integer', min: 0, step: 1 });
		expect(result.success).toBe(false);
	});

	it('rejects a string pattern that is not a valid regular expression', () => {
		const result = ValueTypeSchema.safeParse({ kind: 'string', pattern: '([a-z' });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['pattern']);
	});

	it('rejects minLength > maxLength and min > max', () => {
		expect(ValueTypeSchema.safeParse({ kind: 'string', minLength: 5, maxLength: 2 }).success).toBe(false);
		expect(ValueTypeSchema.safeParse({ kind: 'integer', min: 5, max: 2 }).success).toBe(false);
	});

	it('rejects a decimal without a scale, and an empty or duplicate enum', () => {
		expect(ValueTypeSchema.safeParse({ kind: 'decimal' }).success).toBe(false);
		expect(ValueTypeSchema.safeParse({ kind: 'enum', values: [] }).success).toBe(false);
		expect(ValueTypeSchema.safeParse({ kind: 'enum', values: ['a', 'a'] }).success).toBe(false);
	});

	it('exports to JSON Schema', () => {
		expect(() => z.toJSONSchema(ValueTypeSchema)).not.toThrow();
	});
});
