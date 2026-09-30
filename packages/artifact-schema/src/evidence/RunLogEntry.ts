import { z } from 'zod';
import { ActorSchema } from '../common/Actor.js';
import {
	InterventionIdSchema,
	OutcomeCodeSchema,
	RunIdSchema,
	RunKindSchema,
	StepIdSchema,
} from '../common/Identifiers.js';
import { OriginSchema } from '../common/Origin.js';
import { RiskClassSchema } from '../common/RiskClass.js';
import { CheckpointKindSchema } from '../checkpoint/CheckpointKind.js';
import { InterventionDecisionSchema } from '../control/InterventionRequest.js';
import { LeaseTransitionSchema } from '../control/LeaseState.js';
import { LocatorRungKindSchema } from '../locator/LocatorRungKind.js';
import { ConditionClassSchema } from '../outcome/ConditionClass.js';
import { ArtifactRefSchema } from '../result/ArtifactRef.js';
import { RunResultKindSchema } from '../result/RunResultKind.js';
import { ActionKindSchema } from '../step/ActionKind.js';
import { EvidenceRefSchema } from './EvidenceRef.js';

/** Every run-log entry kind, in the order they typically appear. */
export const RUN_LOG_ENTRY_KINDS = [
	'run_started',
	'observation',
	'decision',
	'policy_verdict',
	'locator_resolved',
	'action',
	'checkpoint',
	'condition_detected',
	'recovery',
	'lease_change',
	'intervention',
	'human_action',
	'result',
] as const;

const redacted = (max: number, what: string) => z.string().max(max).describe(`${what} Redacted.`);

const PolicyVerdictKindSchema = z
	.enum(['allow', 'require_approval', 'deny'])
	.describe('The policy verdict: allow, require_approval (irreversible) or deny.');

const common = {
	seq: z
		.int()
		.min(1)
		.describe('1-based, gap-free sequence number within the run. Assigned by the RunLog writer, never by callers.'),
	at: z.iso.datetime().describe('When the entry was recorded (ISO 8601, UTC).'),
	runId: RunIdSchema,
	actor: ActorSchema.describe('Who produced the entry: agent, replay, or operator:<handle> for human actions.'),
};

const entry = <K extends (typeof RUN_LOG_ENTRY_KINDS)[number], P extends z.ZodRawShape>(
	kind: K,
	payload: P,
	description: string,
) => z.strictObject({ ...common, kind: z.literal(kind), ...payload }).describe(description);

const RunStartedSchema = entry(
	'run_started',
	{
		runKind: RunKindSchema,
		artifact: ArtifactRefSchema.nullable().describe('The artifact being replayed; null for discovery.'),
		goal: redacted(2000, 'The discovery goal with {{param}} placeholders; null for replay.').nullable(),
		origin: OriginSchema.describe('The app origin the run targets (after env expansion).'),
	},
	'The run began.',
);

const ObservationSchema = entry(
	'observation',
	{
		url: redacted(2000, 'Current page URL.'),
		title: redacted(500, 'Current page title.'),
		digest: redacted(4000, 'Compact text digest of the observed screen (frames, headings, key controls).'),
		snapshotRef: EvidenceRefSchema.nullable().describe('The full redacted a11y snapshot, if stored.'),
		screenshotRef: EvidenceRefSchema.nullable().describe('A masked screenshot, if stored.'),
	},
	'The screen was observed.',
);

const DecisionSchema = entry(
	'decision',
	{
		reason: redacted(4000, "The model's stated reason for the tool call (placeholderized)."),
		tool: z
			.string()
			.max(64)
			.regex(/^[a-z][a-z0-9_]*$/)
			.describe('The tool the model called, e.g. "click", "fill", "request_takeover".'),
		input: z
			.record(z.string().max(64), z.unknown())
			.describe('The tool input as the model sent it, placeholderized and redacted.'),
	},
	'A model decision. Discovery runs only: replay has no model in the loop (invariant 1).',
);

const PolicyVerdictSchema = entry(
	'policy_verdict',
	{
		verdict: PolicyVerdictKindSchema,
		code: OutcomeCodeSchema.optional().describe('The deny code, e.g. "route_not_allowed"; absent when allowed.'),
		risk: RiskClassSchema,
		actionKind: ActionKindSchema,
		stepId: StepIdSchema.optional().describe('The artifact step, when the action belongs to one (replay).'),
	},
	'The policy evaluated an action (invariant 2).',
);

const LocatorResolvedSchema = entry(
	'locator_resolved',
	{
		stepId: StepIdSchema,
		rungIndex: z.int().min(0).max(19).describe('0-based index of the rung that matched uniquely.'),
		rungKind: LocatorRungKindSchema,
	},
	"A step's target resolved; rungIndex above 0 means drift.",
);

const ActionSchema = entry(
	'action',
	{
		actionKind: ActionKindSchema,
		risk: RiskClassSchema,
		stepId: StepIdSchema.optional().describe('The artifact step (replay), if any.'),
		target: redacted(500, 'Description of the target control, e.g. "Search button".').optional(),
		durationMs: z.int().min(0).describe('How long the action took, in milliseconds.'),
	},
	'An action was performed on the surface.',
);

const CheckpointEntrySchema = entry(
	'checkpoint',
	{
		stepId: StepIdSchema.nullable().describe("The step verified; null for the artifact's success condition."),
		checkpointKind: CheckpointKindSchema,
		result: z
			.enum(['held', 'failed', 'condition'])
			.describe('held: verified. failed: did not hold. condition: a runtime condition was detected instead.'),
		detail: redacted(1000, 'What was observed when it did not hold.').optional(),
	},
	'A checkpoint was verified (invariant 5).',
);

const ConditionDetectedSchema = entry(
	'condition_detected',
	{
		code: OutcomeCodeSchema,
		class: ConditionClassSchema,
		stepId: StepIdSchema.nullable().describe('The step after which it was detected; null outside a step.'),
	},
	'A runtime condition was recognised.',
);

const RecoveryEntrySchema = entry(
	'recovery',
	{
		code: OutcomeCodeSchema.describe('The recoverable condition being handled.'),
		recoveryKind: z
			.enum(['dismiss_dialog', 'click_through', 'retry', 'reauth'])
			.describe('The kind of the bounded recovery that ran.'),
		attempt: z.int().min(1).describe('1-based attempt number.'),
		budget: z.int().min(1).describe('Maximum attempts allowed.'),
		outcome: z.enum(['succeeded', 'failed']).describe('Whether this attempt cleared the condition.'),
		stepId: StepIdSchema.nullable().describe('The step being recovered; null outside a step.'),
	},
	'A bounded recovery ran. Recoveries are logged, never returned as results (invariant 4).',
);

const LeaseChangeSchema = entry('lease_change', { transition: LeaseTransitionSchema }, 'The control lease moved.');

const InterventionEntrySchema = entry(
	'intervention',
	{
		requestId: InterventionIdSchema,
		interventionKind: z.enum(['approval', 'takeover']).describe('The kind of the intervention request.'),
		event: z.enum(['raised', 'claimed', 'resolved']).describe('What happened to the request.'),
		decision: InterventionDecisionSchema.optional().describe('The decision, on a resolved event.'),
		requestRef: EvidenceRefSchema.optional().describe('The persisted (redacted) request document.'),
	},
	'An intervention request changed.',
);

const HumanActionSchema = entry(
	'human_action',
	{
		actionKind: ActionKindSchema,
		verdict: PolicyVerdictKindSchema,
		refused: z.boolean().describe('true when the action was blocked (denied, or irreversible without approval).'),
		fingerprint: redacted(500, 'Summary of the recorded action, e.g. \'click button "Search" in frame content\'.'),
		stepId: StepIdSchema.optional().describe('The step it was recorded as, if compiled into one.'),
	},
	'An operator action recorded during a takeover. It passes the same policy as agent actions.',
);

const ResultEntrySchema = entry(
	'result',
	{
		resultKind: RunResultKindSchema,
		code: OutcomeCodeSchema.optional().describe('The business outcome code or failure reason, if any.'),
		durationMs: z.int().min(0).describe('Run duration, in milliseconds.'),
	},
	'The run ended. The full result is in result.json.',
);

export const RunLogEntrySchema = z
	.discriminatedUnion('kind', [
		RunStartedSchema,
		ObservationSchema,
		DecisionSchema,
		PolicyVerdictSchema,
		LocatorResolvedSchema,
		ActionSchema,
		CheckpointEntrySchema,
		ConditionDetectedSchema,
		RecoveryEntrySchema,
		LeaseChangeSchema,
		InterventionEntrySchema,
		HumanActionSchema,
		ResultEntrySchema,
	])
	.superRefine((logEntry, ctx) => {
		const runKind = logEntry.runId.startsWith('discovery-') ? 'discovery' : 'replay';
		if (
			(logEntry.actor === 'agent' && runKind !== 'discovery') ||
			(logEntry.actor === 'replay' && runKind !== 'replay')
		) {
			ctx.addIssue({
				code: 'custom',
				path: ['actor'],
				message: `actor "${logEntry.actor}" cannot act in a ${runKind} run`,
			});
		}
		if (logEntry.kind === 'decision' && runKind !== 'discovery') {
			ctx.addIssue({ code: 'custom', path: ['kind'], message: 'decision entries exist only in discovery runs' });
		}
		if (logEntry.kind === 'human_action' && !logEntry.actor.startsWith('operator:')) {
			ctx.addIssue({ code: 'custom', path: ['actor'], message: 'a human_action must come from an operator' });
		}
		if (logEntry.kind === 'run_started' && logEntry.runKind !== runKind) {
			ctx.addIssue({ code: 'custom', path: ['runKind'], message: 'runKind must match the runId prefix' });
		}
		if (logEntry.kind === 'recovery' && logEntry.attempt > logEntry.budget) {
			ctx.addIssue({ code: 'custom', path: ['attempt'], message: 'attempt exceeds the recovery budget' });
		}
	})
	.describe(
		'One line of a run log (run.jsonl). Every entry is redacted before it is written (invariant 3) and carries seq, at, runId and actor.',
	);
export type RunLogEntry = z.infer<typeof RunLogEntrySchema>;

/** A run-log entry as a writer supplies it: the RunLog assigns `seq`. Distributes over the union. */
export type RunLogEntryInput = RunLogEntry extends infer Entry
	? Entry extends unknown
		? Omit<Entry, 'seq'>
		: never
	: never;
