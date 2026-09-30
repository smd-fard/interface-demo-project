import { z } from 'zod';
import { CapabilityArtifactSchema } from './artifact/CapabilityArtifact.js';
import { InterventionRequestSchema } from './control/InterventionRequest.js';
import { RunLogEntrySchema } from './evidence/RunLogEntry.js';
import { RunManifestSchema } from './evidence/RunManifest.js';
import { PolicyConfigSchema } from './policy/PolicyConfig.js';
import { AppProfileSchema } from './profile/AppProfile.js';
import { RunResultSchema } from './result/RunResult.js';
import { ArtifactRefSchema } from './result/ArtifactRef.js';
import { CheckpointSchema } from './checkpoint/Checkpoint.js';
import { ValueExprSchema } from './common/ValueExpr.js';
import { EvidenceRefSchema } from './evidence/EvidenceRef.js';
import { FrameScopeSchema } from './locator/FrameScope.js';
import { LocatorRungSchema } from './locator/LocatorRung.js';
import { TargetRefSchema } from './locator/TargetRef.js';
import { OutcomeRuleSchema } from './outcome/OutcomeRule.js';
import { StepSchema } from './step/Step.js';

/**
 * The public document contracts, by the file name they are exported under (`schemas/<name>.schema.json`).
 * Refinements (cross-field rules such as "every placeholder names a declared param") are enforced by the Zod
 * schemas only; the JSON Schema describes the shape.
 */
export const JSON_SCHEMAS = {
	'capability-artifact': CapabilityArtifactSchema,
	'run-result': RunResultSchema,
	'intervention-request': InterventionRequestSchema,
	'run-log-entry': RunLogEntrySchema,
	'run-manifest': RunManifestSchema,
	'policy-config': PolicyConfigSchema,
	'app-profile': AppProfileSchema,
} as const;
/** The name of a public document contract, i.e. the `<name>` in `schemas/<name>.schema.json`. */
export type JsonSchemaName = keyof typeof JSON_SCHEMAS;

// Parts reused across documents are emitted once under `$defs/<Name>` and referenced, instead of being inlined at
// every use (the artifact would otherwise run to ~22k lines). Named explicitly so the committed files stay readable
// and their diffs stable (automatic reuse would name them "__schema<N>").
const NAMED_PARTS: Readonly<Record<string, z.ZodType>> = {
	Step: StepSchema,
	Checkpoint: CheckpointSchema,
	TargetRef: TargetRefSchema,
	FrameScope: FrameScopeSchema,
	LocatorRung: LocatorRungSchema,
	ValueExpr: ValueExprSchema,
	OutcomeRule: OutcomeRuleSchema,
	EvidenceRef: EvidenceRefSchema,
	ArtifactRef: ArtifactRefSchema,
};

/**
 * Runs `fn` with each named part carrying an `id` in Zod's global registry, then restores the previous metadata.
 * The global registry is the one `.describe()` writes to, so descriptions survive; the ids exist only during the
 * (synchronous) export, so importing this package never leaves ids behind.
 */
function withNamedParts<T>(fn: () => T): T {
	const previous = new Map<z.ZodType, Record<string, unknown> | undefined>();
	for (const [id, schema] of Object.entries(NAMED_PARTS)) {
		const meta = z.globalRegistry.get(schema);
		previous.set(schema, meta);
		z.globalRegistry.remove(schema);
		z.globalRegistry.add(schema, { ...meta, id });
	}
	try {
		return fn();
	} finally {
		for (const [schema, meta] of previous) {
			z.globalRegistry.remove(schema);
			if (meta !== undefined) z.globalRegistry.add(schema, meta);
		}
	}
}

/** A generated JSON Schema document (draft 2020-12). */
export type JsonSchemaDocument = z.core.JSONSchema.BaseSchema;

/**
 * Every registered contract as JSON Schema. Uses `io: 'input'`: the documents describe what a producer may write
 * (and what a loader accepts), so a field with a Zod `.default()` — e.g. ParamSpec `required`/`sensitive` — is
 * optional, exactly as the parser treats it. The output view would wrongly mark those fields required. Pure.
 */
export function toJsonSchemas(): Record<JsonSchemaName, JsonSchemaDocument> {
	return withNamedParts(() => {
		const entries = Object.entries(JSON_SCHEMAS).map(([name, schema]) => [
			name,
			z.toJSONSchema(schema, { io: 'input', target: 'draft-2020-12' }),
		]);
		return Object.fromEntries(entries) as Record<JsonSchemaName, JsonSchemaDocument>;
	});
}
