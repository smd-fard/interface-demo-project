import { z } from 'zod';
import { ActorSchema } from '../common/Actor.js';
import { InterventionIdSchema } from '../common/Identifiers.js';

export const LeaseStateSchema = z
	.enum(['AGENT', 'PAUSED', 'HUMAN', 'RESUMING', 'CLOSED'])
	.describe(
		'Who controls the live session. AGENT: the agent or replay may act. PAUSED: nobody acts; an intervention request is open. HUMAN: an operator drives the same session. RESUMING: control is returning; the agent re-verifies a checkpoint before acting. CLOSED: the session has ended.',
	);
export type LeaseState = z.infer<typeof LeaseStateSchema>;

export const LeaseTransitionSchema = z
	.strictObject({
		from: LeaseStateSchema.describe('State before the transition.'),
		to: LeaseStateSchema.describe('State after the transition.'),
		actor: ActorSchema.describe('Who caused the transition.'),
		reason: z
			.string()
			.min(1)
			.max(500)
			.describe('Why the control moved, e.g. "approval_required before s12-click-confirm". Redacted.'),
		at: z.iso.datetime().describe('When the transition happened (ISO 8601, UTC).'),
		requestId: InterventionIdSchema.optional().describe('The intervention request behind the transition, if any.'),
	})
	.describe('One recorded change of the control lease. The lease history is a list of these, in order.');
export type LeaseTransition = z.infer<typeof LeaseTransitionSchema>;
