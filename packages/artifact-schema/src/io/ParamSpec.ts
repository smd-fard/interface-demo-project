import { z } from 'zod';
import { ParamNameSchema } from '../common/Identifiers.js';
import { ValueTypeSchema } from '../common/ValueType.js';
import { valueSchemaFor } from './valueSchemaFor.js';

export const ParamSpecSchema = z
	.strictObject({
		name: ParamNameSchema,
		description: z
			.string()
			.min(1)
			.max(500)
			.describe('What the caller must supply, written for a calling agent and a reviewer (R2.7).'),
		type: ValueTypeSchema,
		required: z.boolean().default(true).describe('Whether the caller must supply it. Defaults to true.'),
		sensitive: z
			.boolean()
			.default(true)
			.describe(
				'Whether the value is sensitive (PII, account data). Defaults to true: sensitive values are redacted in every sink and can never be stored as literals or examples.',
			),
		example: z
			.string()
			.max(200)
			.optional()
			.describe('A synthetic example value. Forbidden when `sensitive` is true; must match `type`.'),
	})
	.superRefine((spec, ctx) => {
		if (spec.example === undefined) return;
		if (spec.sensitive) {
			ctx.addIssue({
				code: 'custom',
				path: ['example'],
				message: 'a sensitive param must not carry an example value',
			});
			return;
		}
		if (!valueSchemaFor(spec.type, { coerce: true }).safeParse(spec.example).success) {
			ctx.addIssue({ code: 'custom', path: ['example'], message: 'example does not match the declared type' });
		}
	})
	.describe('A typed input of the capability. Steps reference it as {"kind":"param"} or {{name}}.');
export type ParamSpec = z.infer<typeof ParamSpecSchema>;
