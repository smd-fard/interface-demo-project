import { z } from 'zod';
import { CredentialRefSchema, ParamNameSchema } from './Identifiers.js';

const ParamValueExprSchema = z
	.strictObject({
		kind: z.literal('param'),
		name: ParamNameSchema.describe('The declared param whose run-time value is used.'),
	})
	.describe('The value of a declared capability parameter, supplied by the caller at run time.');

const LiteralValueExprSchema = z
	.strictObject({
		kind: z.literal('literal'),
		value: z.string().max(1000).describe('The constant value. Must be non-sensitive.'),
	})
	.describe(
		'A constant baked into the artifact (e.g. an option value "savings"). Only for non-sensitive values: a step that marks its value sensitive refuses a literal (enforced by the step schema), so discovered PII can never be stored here.',
	);

const CredentialValueExprSchema = z
	.strictObject({
		kind: z.literal('credential'),
		ref: CredentialRefSchema,
		field: z.enum(['username', 'password']).describe('Which part of the referenced credential to use.'),
	})
	.describe('A field of a credential resolved at run time from outside the artifact. The secret is never stored.');

export const ValueExprSchema = z
	.discriminatedUnion('kind', [ParamValueExprSchema, LiteralValueExprSchema, CredentialValueExprSchema])
	.describe(
		'The only way a step carries a value: a param reference, a non-sensitive literal, or a credential reference.',
	);
export type ValueExpr = z.infer<typeof ValueExprSchema>;
