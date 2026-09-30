import { z } from 'zod';
import { StepIdSchema } from '../common/Identifiers.js';
import { RiskClassSchema } from '../common/RiskClass.js';
import { TimeoutMsSchema } from '../common/TimeoutMs.js';
import { CheckpointSchema } from '../checkpoint/Checkpoint.js';

/** The fields every step kind shares. Each kind extends it with `kind` and its own fields (strict). */
export const StepBaseSchema = z
	.strictObject({
		id: StepIdSchema,
		description: z
			.string()
			.min(1)
			.max(500)
			.describe(
				'What the step does and why, written for a reviewer and an operator (R2.7), e.g. "Click Search to look up the member". Never contains a concrete param value.',
			),
		phase: z
			.enum(['login', 'main'])
			.describe(
				'login: part of signing on (re-run once on session expiry); main: the capability itself. Login steps come first.',
			),
		risk: RiskClassSchema.describe(
			'Risk class recorded by the compiler. Replay recomputes it from policy and takes the max of the two, so an edited artifact can never lower the risk of a step.',
		),
		checkpoint: CheckpointSchema.optional().describe(
			'The condition verified after the action. Required for screen-changing kinds (navigate, click, press, select, dismiss_dialog) — invariant 5.',
		),
		timeoutMs: TimeoutMsSchema.optional().describe(
			'Upper bound for resolving the target and performing the action; omitted = the engine default.',
		),
	})
	.describe('Fields common to every step.');
export type StepBase = z.infer<typeof StepBaseSchema>;
