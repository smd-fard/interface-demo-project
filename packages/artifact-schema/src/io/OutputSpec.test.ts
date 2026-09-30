import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OutputSpecSchema } from './OutputSpec.js';

const savingsBalance = {
	name: 'savingsBalance',
	description: 'Savings share balance in USD',
	type: { kind: 'decimal', scale: 2 },
	sensitive: true,
};

describe('OutputSpecSchema', () => {
	it('accepts an output spec', () => {
		expect(OutputSpecSchema.parse(savingsBalance)).toEqual(savingsBalance);
	});

	it('defaults sensitive to true', () => {
		const minimal: Record<string, unknown> = { ...savingsBalance };
		delete minimal.sensitive;
		expect(OutputSpecSchema.parse(minimal).sensitive).toBe(true);
	});

	it('rejects a bad name, a missing description and an unknown key', () => {
		expect(OutputSpecSchema.safeParse({ ...savingsBalance, name: 'Savings Balance' }).success).toBe(false);
		const noDescription: Record<string, unknown> = { ...savingsBalance };
		delete noDescription.description;
		expect(OutputSpecSchema.safeParse(noDescription).success).toBe(false);
		expect(OutputSpecSchema.safeParse({ ...savingsBalance, value: '1234.56' }).success).toBe(false);
	});

	it('exports to JSON Schema', () => {
		expect(() => z.toJSONSchema(OutputSpecSchema)).not.toThrow();
	});
});
