// @idp/artifact-schema — the public contracts. Schema + inferred type side by side, one concept per module.

export { SCHEMA_VERSION, SchemaVersionSchema, type SchemaVersion } from './version.js';

// common primitives
export { SemverSchema, type Semver } from './common/Semver.js';
export {
	CapabilityIdSchema,
	type CapabilityId,
	StepIdSchema,
	type StepId,
	ParamNameSchema,
	type ParamName,
	OutputNameSchema,
	type OutputName,
	OutcomeCodeSchema,
	type OutcomeCode,
	CredentialRefSchema,
	type CredentialRef,
	RunKindSchema,
	type RunKind,
	RunIdSchema,
	type RunId,
	InterventionIdSchema,
	type InterventionId,
	ContentHashSchema,
	type ContentHash,
	VendorAppIdSchema,
	type VendorAppId,
	TenantIdSchema,
	type TenantId,
} from './common/Identifiers.js';
export { RISK_ORDER, RiskClassSchema, type RiskClass, maxRisk } from './common/RiskClass.js';
export { ValueTypeSchema, type ValueType } from './common/ValueType.js';
export { TemplateStringSchema, type TemplateString, templatePlaceholders } from './common/TemplateString.js';
export { ValueExprSchema, type ValueExpr } from './common/ValueExpr.js';
export { TimeoutMsSchema, type TimeoutMs } from './common/TimeoutMs.js';
export { RouteSchema, type Route } from './common/Route.js';
export { isValidRegExp } from './common/isValidRegExp.js';
export { canonicalize, computeContentHash } from './common/contentHash.js';
export { CanonicalizationError } from './common/CanonicalizationError.js';

// locators
export { FrameHopSchema, type FrameHop, FrameScopeSchema, type FrameScope } from './locator/FrameScope.js';
export { LocatorRungSchema, type LocatorRung } from './locator/LocatorRung.js';
export { LOCATOR_RUNG_KINDS, LocatorRungKindSchema, type LocatorRungKind } from './locator/LocatorRungKind.js';
export { TargetRefSchema, type TargetRef } from './locator/TargetRef.js';

// checkpoints
export { CheckpointSchema, type Checkpoint } from './checkpoint/Checkpoint.js';
export { CHECKPOINT_KINDS, CheckpointKindSchema, type CheckpointKind } from './checkpoint/CheckpointKind.js';

// params and outputs
export { ParamSpecSchema, type ParamSpec } from './io/ParamSpec.js';
export { OutputSpecSchema, type OutputSpec } from './io/OutputSpec.js';
export { valueSchemaFor, type ScalarValue, type ValueSchemaOptions } from './io/valueSchemaFor.js';
export { paramsSchemaFor, type ParamValues } from './io/paramsSchemaFor.js';
export { outputsSchemaFor, type OutputValues } from './io/outputsSchemaFor.js';
export { DuplicateSpecNameError } from './io/DuplicateSpecNameError.js';

// steps
export { ACTION_KINDS, SCREEN_CHANGING_KINDS, ActionKindSchema, type ActionKind } from './step/ActionKind.js';
export { StepBaseSchema, type StepBase } from './step/StepBase.js';
export { StepSchema, type Step, type StepOf } from './step/Step.js';

// outcome rules and app profile
export { ConditionSignatureSchema, type ConditionSignature } from './outcome/ConditionSignature.js';
export { ConditionClassSchema, type ConditionClass } from './outcome/ConditionClass.js';
export { RecoverySchema, type Recovery } from './outcome/Recovery.js';
export { OutcomeRuleSchema, type OutcomeRule, OutcomeScopeSchema, type OutcomeScope } from './outcome/OutcomeRule.js';
export { KnownDialogSchema, type KnownDialog } from './profile/KnownDialog.js';
export { AppProfileSchema, type AppProfile } from './profile/AppProfile.js';

// the capability artifact
export { CapabilityArtifactSchema, type CapabilityArtifact } from './artifact/CapabilityArtifact.js';

// run results
export { ArtifactRefSchema, type ArtifactRef } from './result/ArtifactRef.js';
export { RUN_RESULT_KINDS, RunResultKindSchema, type RunResultKind } from './result/RunResultKind.js';
export { FAILURE_REASONS, FailureReasonSchema, type FailureReason } from './result/FailureReason.js';
export { RunResultSchema, type RunResult } from './result/RunResult.js';

// control: lease and intervention requests
export { ActorSchema, type Actor, OperatorActorSchema, type OperatorActor } from './common/Actor.js';
export {
	LeaseStateSchema,
	type LeaseState,
	LeaseTransitionSchema,
	type LeaseTransition,
} from './control/LeaseState.js';
export {
	InterventionDecisionSchema,
	type InterventionDecision,
	InterventionRequestSchema,
	type InterventionRequest,
} from './control/InterventionRequest.js';

// evidence: refs, run log, manifest
export {
	EvidenceIdSchema,
	type EvidenceId,
	EvidenceKindSchema,
	type EvidenceKind,
	EvidenceRefSchema,
	type EvidenceRef,
	RunRelativePathSchema,
	type RunRelativePath,
} from './evidence/EvidenceRef.js';
export {
	RUN_LOG_ENTRY_KINDS,
	RunLogEntrySchema,
	type RunLogEntry,
	type RunLogEntryInput,
} from './evidence/RunLogEntry.js';
export { RunManifestSchema, type RunManifest } from './evidence/RunManifest.js';

// policy configuration
export { OriginSchema, type Origin } from './common/Origin.js';
export { PolicyConfigSchema, type PolicyConfig } from './policy/PolicyConfig.js';

// JSON Schema export
export { JSON_SCHEMAS, type JsonSchemaName, type JsonSchemaDocument, toJsonSchemas } from './jsonSchema.js';
