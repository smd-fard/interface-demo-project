import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ValueExprSchema } from './ValueExpr.js';

describe('ValueExprSchema', () => {
	it.each([
		{ kind: 'param', name: 'memberId' },
		{ kind: 'literal', value: 'savings' },
		{ kind: 'credential', ref: 'mockbank-operator', field: 'username' },
		{ kind: 'credential', ref: 'mockbank-operator', field: 'password' },
	])('accepts %j', (value) => {
		expect(ValueExprSchema.parse(value)).toEqual(value);
	});

	it('rejects an unknown kind', () => {
		expect(ValueExprSchema.safeParse({ kind: 'env', name: 'X' }).success).toBe(false);
	});

	it('rejects a template or raw value where a param name is expected', () => {
		const result = ValueExprSchema.safeParse({ kind: 'param', name: '{{memberId}}' });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['name']);
	});

	it('rejects a raw password embedded in a credential reference (strict)', () => {
		const result = ValueExprSchema.safeParse({
			kind: 'credential',
			ref: 'mockbank-operator',
			field: 'password',
			value: 'hunter2',
		});
		expect(result.success).toBe(false);
	});

	it('rejects a credential field other than username/password', () => {
		expect(ValueExprSchema.safeParse({ kind: 'credential', ref: 'mockbank-operator', field: 'otp' }).success).toBe(
			false,
		);
	});

	it('exports to JSON Schema', () => {
		expect(() => z.toJSONSchema(ValueExprSchema)).not.toThrow();
	});
});
