import { z } from 'zod';

export const ConditionClassSchema = z
	.enum(['business_outcome', 'recoverable', 'failure'])
	.describe(
		'How a recognised condition is handled. business_outcome: a valid answer returned to the caller (e.g. member_not_found), never a failure. recoverable: handled inside the run by a bounded recovery and logged, never returned. failure: the run stops with evidence (or escalates to a human).',
	);
export type ConditionClass = z.infer<typeof ConditionClassSchema>;
