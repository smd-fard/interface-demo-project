import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SCHEMA_VERSION, SchemaVersionSchema } from './version.js';

describe('SchemaVersionSchema', () => {
	it('is the initial public contract 1.0.0', () => {
		expect(SCHEMA_VERSION).toBe('1.0.0');
		expect(SchemaVersionSchema.parse('1.0.0')).toBe('1.0.0');
	});

	it('rejects any other version', () => {
		expect(SchemaVersionSchema.safeParse('0.9.0').success).toBe(false);
		expect(SchemaVersionSchema.safeParse('1.0').success).toBe(false);
	});

	it('exports to JSON Schema', () => {
		expect(z.toJSONSchema(SchemaVersionSchema)).toMatchObject({ const: '1.0.0' });
	});
});
