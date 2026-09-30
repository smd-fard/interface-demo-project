import { z } from 'zod';
import { OutputNameSchema } from '../common/Identifiers.js';
import { ValueTypeSchema } from '../common/ValueType.js';

export const OutputSpecSchema = z
	.strictObject({
		name: OutputNameSchema,
		description: z
			.string()
			.min(1)
			.max(500)
			.describe('What the value means, written for a calling agent and a reviewer (R2.7).'),
		type: ValueTypeSchema,
		sensitive: z
			.boolean()
			.default(true)
			.describe('Whether the value is sensitive. Defaults to true: it is redacted in logs and evidence.'),
	})
	.describe('A typed output of the capability, produced by exactly one extract step and returned on success.');
export type OutputSpec = z.infer<typeof OutputSpecSchema>;
