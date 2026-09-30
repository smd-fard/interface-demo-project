import { z } from 'zod';

/** The three result kinds. There is deliberately no kind for a recoverable condition (invariant 4). */
export const RUN_RESULT_KINDS = ['success', 'business_outcome', 'failure'] as const;

export const RunResultKindSchema = z
	.enum(RUN_RESULT_KINDS)
	.describe(
		'success: outputs returned. business_outcome: a valid business answer such as member_not_found (not a failure). failure: the run could not complete.',
	);
export type RunResultKind = z.infer<typeof RunResultKindSchema>;
