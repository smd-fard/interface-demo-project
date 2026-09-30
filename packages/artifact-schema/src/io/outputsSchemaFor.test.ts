import { describe, expect, it } from 'vitest';
import { outputsSchemaFor } from './outputsSchemaFor.js';
import { DuplicateSpecNameError } from './DuplicateSpecNameError.js';
import type { OutputSpec } from './OutputSpec.js';

const specs: OutputSpec[] = [
	{ name: 'savingsBalance', description: 'Savings balance', type: { kind: 'decimal', scale: 2 }, sensitive: true },
	{ name: 'memberName', description: 'Member full name', type: { kind: 'string', minLength: 1 }, sensitive: true },
	{ name: 'accountCount', description: 'Number of sub-accounts', type: { kind: 'integer', min: 0 }, sensitive: false },
	{ name: 'isActive', description: 'Membership active', type: { kind: 'boolean' }, sensitive: false },
];

describe('outputsSchemaFor', () => {
	const schema = outputsSchemaFor(specs);
	const valid = { savingsBalance: '1234.56', memberName: 'Test Member', accountCount: 2, isActive: true };

	it('accepts typed outputs', () => {
		expect(schema.parse(valid)).toEqual(valid);
	});

	it('requires every declared output', () => {
		const missing: Record<string, unknown> = { ...valid };
		delete missing.memberName;
		const result = schema.safeParse(missing);
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['memberName']);
	});

	it('does not coerce: outputs are already typed', () => {
		expect(schema.safeParse({ ...valid, accountCount: '2' }).success).toBe(false);
		expect(schema.safeParse({ ...valid, isActive: 'true' }).success).toBe(false);
	});

	it('keeps decimals as strings and rejects numbers', () => {
		expect(schema.safeParse({ ...valid, savingsBalance: 1234.56 }).success).toBe(false);
		expect(schema.safeParse({ ...valid, savingsBalance: '1234.567' }).success).toBe(false);
	});

	it('rejects an extra key (strict)', () => {
		expect(schema.safeParse({ ...valid, ssn: '000-00-0000' }).success).toBe(false);
	});

	it('throws a typed error on duplicate output names', () => {
		const first = specs[0];
		if (first === undefined) throw new Error('fixture missing');
		try {
			outputsSchemaFor([first, first]);
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(DuplicateSpecNameError);
			expect((error as DuplicateSpecNameError).code).toBe('duplicate_spec_name');
		}
	});
});
