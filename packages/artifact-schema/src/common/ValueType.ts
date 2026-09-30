import { z } from 'zod';
import { isValidRegExp } from './isValidRegExp.js';

const StringTypeSchema = z
	.strictObject({
		kind: z.literal('string'),
		pattern: z
			.string()
			.min(1)
			.refine(isValidRegExp, { message: 'pattern must be a valid regular expression' })
			.optional()
			.describe('ECMAScript regular expression the whole value must match (implicitly anchored with ^…$).'),
		minLength: z.int().nonnegative().optional().describe('Minimum length in characters.'),
		maxLength: z.int().nonnegative().optional().describe('Maximum length in characters.'),
	})
	.refine((t) => t.minLength === undefined || t.maxLength === undefined || t.minLength <= t.maxLength, {
		message: 'minLength must not exceed maxLength',
		path: ['minLength'],
	})
	.describe('Free text, optionally constrained by a full-match pattern and length bounds.');

const IntegerTypeSchema = z
	.strictObject({
		kind: z.literal('integer'),
		min: z.int().optional().describe('Inclusive lower bound.'),
		max: z.int().optional().describe('Inclusive upper bound.'),
	})
	.refine((t) => t.min === undefined || t.max === undefined || t.min <= t.max, {
		message: 'min must not exceed max',
		path: ['min'],
	})
	.describe('A safe integer. As a param it may arrive as a digit string (CLI) and is coerced to a number.');

const DecimalTypeSchema = z
	.strictObject({
		kind: z.literal('decimal'),
		scale: z.int().min(0).max(10).describe('Maximum number of fractional digits, e.g. 2 for a currency amount.'),
	})
	.describe(
		'An exact decimal, always represented as a string matching ^-?\\d+(\\.\\d+)?$ with at most `scale` fractional digits (e.g. "1234.56"). Never a JSON number, to avoid floating-point loss on money.',
	);

const BooleanTypeSchema = z
	.strictObject({ kind: z.literal('boolean') })
	.describe('true/false. As a param the strings "true"/"false" are accepted and coerced.');

const EnumTypeSchema = z
	.strictObject({
		kind: z.literal('enum'),
		values: z
			.array(z.string().min(1))
			.min(1)
			.refine((values) => new Set(values).size === values.length, { message: 'enum values must be unique' })
			.describe('The allowed values, e.g. the option values of a dropdown.'),
	})
	.describe('One of a fixed set of strings.');

const DateTypeSchema = z
	.strictObject({ kind: z.literal('date') })
	.describe('An ISO 8601 calendar date string "YYYY-MM-DD".');

export const ValueTypeSchema = z
	.discriminatedUnion('kind', [
		StringTypeSchema,
		IntegerTypeSchema,
		DecimalTypeSchema,
		BooleanTypeSchema,
		EnumTypeSchema,
		DateTypeSchema,
	])
	.describe('The value vocabulary shared by params and outputs, discriminated on `kind`.');
export type ValueType = z.infer<typeof ValueTypeSchema>;
