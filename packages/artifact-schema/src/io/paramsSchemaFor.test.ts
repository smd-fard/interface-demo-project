import { describe, expect, it } from 'vitest';
import { paramsSchemaFor } from './paramsSchemaFor.js';
import { DuplicateSpecNameError } from './DuplicateSpecNameError.js';
import type { ParamSpec } from './ParamSpec.js';

const specs: ParamSpec[] = [
	{
		name: 'memberId',
		description: 'Member number',
		type: { kind: 'string', pattern: '\\d{5,8}' },
		required: true,
		sensitive: true,
	},
	{
		name: 'amount',
		description: 'Opening deposit',
		type: { kind: 'decimal', scale: 2 },
		required: true,
		sensitive: true,
	},
	{
		name: 'term',
		description: 'Term in months',
		type: { kind: 'integer', min: 1, max: 60 },
		required: false,
		sensitive: false,
	},
	{ name: 'joint', description: 'Joint account', type: { kind: 'boolean' }, required: false, sensitive: false },
	{
		name: 'product',
		description: 'Product',
		type: { kind: 'enum', values: ['savings', 'checking'] },
		required: true,
		sensitive: false,
	},
	{ name: 'openOn', description: 'Open date', type: { kind: 'date' }, required: false, sensitive: false },
];

describe('paramsSchemaFor', () => {
	const schema = paramsSchemaFor(specs);

	it('accepts CLI-style string params and coerces integer/boolean', () => {
		expect(
			schema.parse({
				memberId: '12345',
				amount: '100.00',
				term: '12',
				joint: 'true',
				product: 'savings',
				openOn: '2026-10-01',
			}),
		).toEqual({ memberId: '12345', amount: '100.00', term: 12, joint: true, product: 'savings', openOn: '2026-10-01' });
	});

	it('accepts typed JSON params', () => {
		expect(schema.parse({ memberId: '12345', amount: '5', term: 6, joint: false, product: 'checking' })).toMatchObject({
			term: 6,
			joint: false,
		});
	});

	it('allows missing optional params', () => {
		expect(schema.parse({ memberId: '12345', amount: '5', product: 'savings' })).toEqual({
			memberId: '12345',
			amount: '5',
			product: 'savings',
		});
	});

	it('rejects a missing required param with its name as the path', () => {
		const result = schema.safeParse({ amount: '5', product: 'savings' });
		expect(result.success).toBe(false);
		expect(result.error?.issues.map((i) => i.path)).toEqual([['memberId']]);
	});

	it('rejects values that break the declared type or pattern', () => {
		const base = { memberId: '12345', amount: '5', product: 'savings' };
		expect(schema.safeParse({ ...base, memberId: 'abc' }).success).toBe(false);
		expect(schema.safeParse({ ...base, amount: '5.001' }).success).toBe(false);
		expect(schema.safeParse({ ...base, amount: 5 }).success).toBe(false);
		expect(schema.safeParse({ ...base, term: '0' }).success).toBe(false);
		expect(schema.safeParse({ ...base, product: 'brokerage' }).success).toBe(false);
	});

	it('rejects an extra key (strict)', () => {
		const result = schema.safeParse({ memberId: '12345', amount: '5', product: 'savings', ssn: '000-00-0000' });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
	});

	it('builds an empty strict object for no params', () => {
		expect(paramsSchemaFor([]).parse({})).toEqual({});
		expect(paramsSchemaFor([]).safeParse({ x: '1' }).success).toBe(false);
	});

	it('throws a typed error on duplicate param names', () => {
		const first = specs[0];
		if (first === undefined) throw new Error('fixture missing');
		expect(() => paramsSchemaFor([first, first])).toThrow(DuplicateSpecNameError);
	});
});
