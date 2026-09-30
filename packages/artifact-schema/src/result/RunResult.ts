import { z } from 'zod';
import {
	InterventionIdSchema,
	OutcomeCodeSchema,
	OutputNameSchema,
	RunIdSchema,
	StepIdSchema,
} from '../common/Identifiers.js';
import { EvidenceRefSchema } from '../evidence/EvidenceRef.js';
import { LocatorRungKindSchema } from '../locator/LocatorRungKind.js';
import { ArtifactRefSchema } from './ArtifactRef.js';
import { FailureReasonSchema } from './FailureReason.js';

const redactedText = (what: string) =>
	z.string().max(2000).describe(`${what} Already redacted: sensitive values are masked before the result is built.`);

const OutputValueSchema = z
	.union([z.string().max(2000), z.number(), z.boolean()])
	.describe('One output value, typed per its OutputSpec. Decimals are strings (e.g. "1523.47").');

const DriftSchema = z
	.strictObject({
		stepId: StepIdSchema,
		rungIndex: z
			.int()
			.min(1)
			.max(19)
			.describe('0-based index of the rung that matched; always above 0 here (rung 0 matching is not drift).'),
		rungKind: LocatorRungKindSchema,
	})
	.describe('A step whose target resolved only on a fallback rung: a sign the primary locator is drifting (R3.4).');

const SuccessSchema = z
	.strictObject({
		kind: z.literal('success'),
		runId: RunIdSchema,
		artifact: ArtifactRefSchema,
		outputs: z
			.record(OutputNameSchema, OutputValueSchema)
			.describe(
				'Declared outputs by name, each validated against its OutputSpec. Sensitive outputs are masked in sinks.',
			),
		durationMs: z.int().min(0).describe('Wall-clock duration of the run, in milliseconds.'),
		drift: z.array(DriftSchema).max(200).describe('Steps that resolved on a fallback rung; empty when none did.'),
		recoveries: z
			.int()
			.min(0)
			.describe('How many bounded recoveries ran (e.g. a dismissed dialog, a re-auth). Each is in the run log.'),
	})
	.describe('The capability completed, its success condition held and every output validated.');

const BusinessOutcomeSchema = z
	.strictObject({
		kind: z.literal('business_outcome'),
		runId: RunIdSchema,
		artifact: ArtifactRefSchema,
		code: OutcomeCodeSchema,
		message: redactedText('What the app showed, e.g. "No records match your search criteria".'),
		stepId: StepIdSchema.describe('The step after which the outcome was detected.'),
	})
	.describe('The app gave a valid business answer that is not the happy path, e.g. member_not_found. Not a failure.');

const FailedStepSchema = z
	.strictObject({
		index: z.int().min(0).describe('0-based position of the step in the artifact.'),
		id: StepIdSchema,
	})
	.describe('The step that failed.');

const FailureSchema = z
	.strictObject({
		kind: z.literal('failure'),
		runId: RunIdSchema,
		artifact: ArtifactRefSchema.nullable().describe(
			'The artifact that ran; null when the artifact itself was invalid.',
		),
		reason: FailureReasonSchema,
		step: FailedStepSchema.nullable().describe('The failing step; null when the run failed before or outside a step.'),
		expected: redactedText('What the step or check expected to see.'),
		observed: redactedText('What was actually observed.'),
		evidence: z.array(EvidenceRefSchema).max(100).describe('Evidence captured at the failure (screenshot, snapshot).'),
		interventionRequestId: InterventionIdSchema.optional().describe(
			'The intervention request raised for this failure, if a human was asked to help.',
		),
	})
	.describe('The run could not complete. Says where, what was expected, what was observed, and where the evidence is.');

export const RunResultSchema = z
	.discriminatedUnion('kind', [SuccessSchema, BusinessOutcomeSchema, FailureSchema])
	.describe(
		'The result of a run: success | business_outcome | failure. Recoverable conditions are handled inside the run and logged; they are never a result (invariant 4).',
	);
export type RunResult = z.infer<typeof RunResultSchema>;
