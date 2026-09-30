import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ParamSpecSchema } from './ParamSpec.js';

const memberId = {
	name: 'memberId',
	description: 'Member number to look up',
	type: { kind: 'string', pattern: '\\d{5,8}' },
	required: true,
	sensitive: true,
};

describe('ParamSpecSchema', () => {
	it('accepts a sensitive param without an example', () => {
		expect(ParamSpecSchema.parse(memberId)).toEqual(memberId);
	});

	it('defaults sensitive to true and required to true', () => {
		const minimal: Record<string, unknown> = { ...memberId };
		delete minimal.sensitive;
		delete minimal.required;
		expect(ParamSpecSchema.parse(minimal)).toMatchObject({ sensitive: true, required: true });
	});

	it('accepts an example on a non-sensitive param', () => {
		const accountType = {
			name: 'accountType',
			description: 'Sub-account product',
			type: { kind: 'enum', values: ['savings', 'checking'] },
			required: true,
			sensitive: false,
			example: 'savings',
		};
		expect(ParamSpecSchema.parse(accountType)).toEqual(accountType);
	});

	it('rejects an example on a sensitive param (it would store a concrete value)', () => {
		const result = ParamSpecSchema.safeParse({ ...memberId, example: '12345' });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['example']);
	});

	it('rejects an example on a param whose sensitivity defaults to true', () => {
		const implicit: Record<string, unknown> = { ...memberId };
		delete implicit.sensitive;
		expect(ParamSpecSchema.safeParse({ ...implicit, example: '12345' }).success).toBe(false);
	});

	it('rejects an example that does not match the declared type', () => {
		const result = ParamSpecSchema.safeParse({
			name: 'accountType',
			description: 'Sub-account product',
			type: { kind: 'enum', values: ['savings', 'checking'] },
			sensitive: false,
			example: 'brokerage',
		});
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['example']);
	});

	it('rejects a bad name, a missing type and an unknown key', () => {
		expect(ParamSpecSchema.safeParse({ ...memberId, name: 'member_id' }).success).toBe(false);
		const noType: Record<string, unknown> = { ...memberId };
		delete noType.type;
		expect(ParamSpecSchema.safeParse(noType).success).toBe(false);
		expect(ParamSpecSchema.safeParse({ ...memberId, default: '1' }).success).toBe(false);
	});

	it('exports to JSON Schema', () => {
		expect(() => z.toJSONSchema(ParamSpecSchema)).not.toThrow();
	});
});
