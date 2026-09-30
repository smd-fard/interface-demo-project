import { z } from 'zod';
import { OutcomeCodeSchema, StepIdSchema } from '../common/Identifiers.js';
import { TargetRefSchema } from '../locator/TargetRef.js';
import { ConditionClassSchema } from './ConditionClass.js';
import { ConditionSignatureSchema } from './ConditionSignature.js';
import { RecoverySchema } from './Recovery.js';

export const OutcomeScopeSchema = z
	.union([
		z.literal('any_step').describe('The rule is checked before and after every step.'),
		z
			.array(StepIdSchema)
			.min(1)
			.max(100)
			.describe('The rule is checked only around these steps (e.g. not-found only after the Search click).'),
	])
	.describe('Where the rule applies.');
export type OutcomeScope = z.infer<typeof OutcomeScopeSchema>;

export const OutcomeRuleSchema = z
	.strictObject({
		code: OutcomeCodeSchema,
		class: ConditionClassSchema,
		description: z
			.string()
			.min(1)
			.max(500)
			.describe('What the condition means for the caller and the reviewer (R2.7).'),
		signature: ConditionSignatureSchema,
		scope: OutcomeScopeSchema,
		message: TargetRefSchema.optional().describe(
			'Element whose text becomes the result message. The text passes the redaction layer before it reaches any sink; omitted = the description is used.',
		),
		recovery: RecoverySchema.optional().describe('Required when class is recoverable; forbidden otherwise.'),
	})
	.superRefine((rule, ctx) => {
		if (rule.class === 'recoverable' && rule.recovery === undefined) {
			ctx.addIssue({ code: 'custom', path: ['recovery'], message: 'a recoverable rule must define its recovery' });
		}
		if (rule.class !== 'recoverable' && rule.recovery !== undefined) {
			ctx.addIssue({
				code: 'custom',
				path: ['recovery'],
				message: `a ${rule.class} rule must not define a recovery: only recoverable conditions are recovered (invariant 4)`,
			});
		}
	})
	.describe(
		'Recognises one runtime condition and says how it is classified and handled. Resolution order at replay: artifact rule, then app profile default, then engine catalog default.',
	);
export type OutcomeRule = z.infer<typeof OutcomeRuleSchema>;
