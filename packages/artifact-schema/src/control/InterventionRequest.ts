import { z } from 'zod';
import { OperatorActorSchema } from '../common/Actor.js';
import {
	CapabilityIdSchema,
	InterventionIdSchema,
	OutcomeCodeSchema,
	RunIdSchema,
	RunKindSchema,
	StepIdSchema,
} from '../common/Identifiers.js';
import { RiskClassSchema } from '../common/RiskClass.js';
import { SemverSchema } from '../common/Semver.js';
import { EvidenceRefSchema } from '../evidence/EvidenceRef.js';

export const InterventionDecisionSchema = z
	.enum(['approve', 'reject', 'resumed', 'aborted'])
	.describe(
		'How a request was resolved. approve/reject: an approval request was answered. resumed: the operator took control and handed it back. aborted: the operator ended the run.',
	);
export type InterventionDecision = z.infer<typeof InterventionDecisionSchema>;

const redacted = (max: number, what: string) =>
	z.string().min(1).max(max).describe(`${what} Redacted before the request is built.`);

const SubjectSchema = z
	.discriminatedUnion('kind', [
		z
			.strictObject({
				kind: z.literal('capability'),
				id: CapabilityIdSchema,
				version: SemverSchema.describe('Version of the capability being replayed.'),
			})
			.describe('A replay run: the capability being executed.'),
		z
			.strictObject({
				kind: z.literal('goal'),
				goal: redacted(2000, 'The natural-language discovery goal, with sensitive values as {{param}} placeholders.'),
			})
			.describe('A discovery run: the goal the agent is pursuing.'),
	])
	.describe('What the run is doing: a capability (replay) or a goal (discovery).');

export const InterventionRequestSchema = z
	.strictObject({
		id: InterventionIdSchema,
		runId: RunIdSchema,
		runKind: RunKindSchema,
		kind: z
			.enum(['approval', 'takeover'])
			.describe(
				'approval: an irreversible action awaits an operator decision. takeover: the run is stuck and asks an operator to drive the same live session.',
			),
		reason: z
			.strictObject({
				code: OutcomeCodeSchema.describe('Stable snake_case reason, e.g. "approval_required", "target_unresolved".'),
				text: redacted(1000, 'Human-readable explanation.'),
			})
			.describe('Why the run paused.'),
		subject: SubjectSchema,
		currentStep: z
			.strictObject({
				index: z.int().min(0).describe('0-based step index (replay) or action count so far (discovery).'),
				id: StepIdSchema.optional().describe('The artifact step id; absent in discovery, which has no steps yet.'),
				description: redacted(500, 'What the paused step does, e.g. "Click Confirm".'),
				risk: RiskClassSchema,
			})
			.describe('The step or action the run paused before.'),
		state: z
			.strictObject({
				url: redacted(2000, 'The current page URL.'),
				title: z.string().max(500).describe('The current page title. Redacted.'),
				screenshotRef: EvidenceRefSchema.nullable().describe(
					'Masked screenshot at pause time; null if capture failed.',
				),
				a11ySnapshotRef: EvidenceRefSchema.nullable().describe(
					'Redacted accessibility snapshot at pause time; null if capture failed.',
				),
			})
			.describe('What the screen looked like when the run paused.'),
		options: z
			.array(InterventionDecisionSchema)
			.min(1)
			.max(4)
			.describe('The decisions the operator may take, without duplicates.'),
		status: z
			.enum(['open', 'claimed', 'resolved'])
			.describe('open: waiting. claimed: an operator took it (and may hold control). resolved: decided.'),
		resolution: z
			.strictObject({
				decision: InterventionDecisionSchema,
				by: OperatorActorSchema.describe('The operator who resolved it.'),
				at: z.iso.datetime().describe('When it was resolved (ISO 8601, UTC).'),
			})
			.optional()
			.describe('The decision; present exactly when status is resolved.'),
		createdAt: z.iso.datetime().describe('When the request was raised (ISO 8601, UTC).'),
	})
	.superRefine((request, ctx) => {
		if (!request.runId.startsWith(`${request.runKind}-`)) {
			ctx.addIssue({ code: 'custom', path: ['runKind'], message: 'runKind must match the runId prefix' });
		}
		const expectedSubject = request.runKind === 'replay' ? 'capability' : 'goal';
		if (request.subject.kind !== expectedSubject) {
			ctx.addIssue({
				code: 'custom',
				path: ['subject', 'kind'],
				message: `a ${request.runKind} run's subject must be a ${expectedSubject}`,
			});
		}
		const seen = new Set<string>();
		request.options.forEach((option, index) => {
			if (seen.has(option)) ctx.addIssue({ code: 'custom', path: ['options', index], message: 'duplicate option' });
			seen.add(option);
		});
		if ((request.status === 'resolved') !== (request.resolution !== undefined)) {
			ctx.addIssue({
				code: 'custom',
				path: ['resolution'],
				message: 'resolution must be present exactly when status is "resolved"',
			});
		}
		if (request.resolution !== undefined && !request.options.includes(request.resolution.decision)) {
			ctx.addIssue({
				code: 'custom',
				path: ['resolution', 'decision'],
				message: 'the decision must be one of the offered options',
			});
		}
	})
	.describe(
		'A request for a human: approve an irreversible action or take over the same live session. Built from redacted data only; screenshots are masked (invariant 3).',
	);
export type InterventionRequest = z.infer<typeof InterventionRequestSchema>;
