import { z } from 'zod';
import type { ValueType } from '../common/ValueType.js';

/** A runtime param/output value. Decimals are strings (see ValueType `decimal`). */
export type ScalarValue = string | number | boolean;

/** Options of {@link valueSchemaFor}. */
export interface ValueSchemaOptions {
	/**
	 * true for params, which may arrive as strings from a CLI: integer accepts a digit string ("12" → 12) and
	 * boolean accepts "true"/"false". false for outputs, which are already typed. Decimals are never coerced.
	 */
	readonly coerce: boolean;
}

function decimalPattern(scale: number): RegExp {
	return scale === 0 ? /^-?\d+$/ : new RegExp(`^-?\\d+(?:\\.\\d{1,${scale}})?$`);
}

/** The runtime Zod schema for one value of the given ValueType. */
export function valueSchemaFor(type: ValueType, options: ValueSchemaOptions): z.ZodType<ScalarValue> {
	switch (type.kind) {
		case 'string': {
			let schema = z.string();
			if (type.pattern !== undefined) schema = schema.regex(new RegExp(`^(?:${type.pattern})$`));
			if (type.minLength !== undefined) schema = schema.min(type.minLength);
			if (type.maxLength !== undefined) schema = schema.max(type.maxLength);
			return schema;
		}
		case 'integer': {
			let schema = z.int();
			if (type.min !== undefined) schema = schema.min(type.min);
			if (type.max !== undefined) schema = schema.max(type.max);
			if (!options.coerce) return schema;
			return z
				.union([
					z.number(),
					z
						.string()
						.regex(/^-?\d+$/)
						.transform((value) => Number(value)),
				])
				.pipe(schema);
		}
		case 'decimal':
			return z.string().regex(decimalPattern(type.scale), {
				message: `expected a decimal string with at most ${type.scale} fractional digits`,
			});
		case 'boolean':
			if (!options.coerce) return z.boolean();
			return z.union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')]);
		case 'enum':
			return z.enum(type.values);
		case 'date':
			return z.iso.date();
	}
}
