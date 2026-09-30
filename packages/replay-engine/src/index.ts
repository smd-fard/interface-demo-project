// @idp/replay-engine — the deterministic executor for capability artifacts (R3, R3.1). No model anywhere in the
// decision loop (invariant 1): steps run through the session's leased, policy-guarded surface, every checkpoint
// is verified, and the run ends as success | business_outcome | failure (invariant 4).

// the engine
export { replay, type ReplayInput } from './ReplayEngine.js';
export {
	DEFAULT_REPLAY_OPTIONS,
	resolveReplayOptions,
	type ReplayOptions,
	type ReplayOptionsInput,
} from './ReplayOptions.js';
export type { ReplaySession } from './ReplaySession.js';

// params and credentials
export type { Credential } from './params/Credential.js';
export type { CredentialProvider } from './params/CredentialProvider.js';
export { InMemoryCredentialProvider } from './params/InMemoryCredentialProvider.js';
export { createValueBinder, paramBindings, type ValueBinder, type ValueBinderOptions } from './params/bindValues.js';

// checkpoints and the condition seam
export { CheckpointVerifier, type CheckpointVerifierOptions } from './checkpoints/CheckpointVerifier.js';
export type { CheckpointVerdict } from './checkpoints/CheckpointVerdict.js';
export type { ConditionDetector } from './checkpoints/ConditionDetector.js';
export { describeCheckpoint } from './checkpoints/describeCheckpoint.js';

// runtime conditions (steps 35+)
export {
	CONDITION_CATALOG,
	CONDITION_CODES,
	catalogEntry,
	shouldEscalate,
	type ConditionCatalogEntry,
	type ConditionCode,
	type ConditionResponse,
	type DetectorId,
} from './conditions/ConditionCatalog.js';
export { detectConditions, matchSignature, type ConditionMatch } from './conditions/detectConditions.js';
export {
	resolveCondition,
	resolveRules,
	type ResolvedCondition,
	type ResolvedRule,
	type RuleSources,
} from './conditions/resolveRules.js';
export { ConditionWatch, UNKNOWN_DIALOG } from './conditions/ConditionWatch.js';
export { respondToCondition } from './conditions/respondToCondition.js';
export { classifyCondition, type ClassifyInput } from './conditions/classifyCondition.js';
export type { DetectedCondition } from './conditions/DetectedCondition.js';
export type { ConditionReply, RecoveryPlan } from './conditions/ConditionReply.js';
export { failureReasonFor } from './conditions/failureReasonFor.js';
export { knownDialogRules } from './conditions/knownDialogRules.js';

// bounded recovery (steps 38–41)
export { StepRecovery, type PendingRecovery } from './recovery/StepRecovery.js';
export { logRecovery, type RecoveryAttempt } from './recovery/logRecovery.js';
export { dismissKnownDialog, type DismissKnownDialogInput } from './recovery/dismissKnownDialog.js';
export { waitForSlowLoad, FAILED_LOAD, type WaitForSlowLoadInput } from './recovery/waitForSlowLoad.js';

// approval gate and escalation (step 34)
export type { EscalationSession } from './escalation/EscalationSession.js';
export { handleApproval, type HandleApprovalInput } from './escalation/handleApproval.js';
export { handleHardFailure, type HandleHardFailureInput } from './escalation/handleHardFailure.js';

// outputs and results
export { extractOutputs, parseExtracted, type ExtractParse, type RawExtraction } from './outputs/extractOutputs.js';
export { ResultBuilder, type FailureInput, type ResultBuilderOptions } from './result/ResultBuilder.js';
export { redactResultForSink } from './result/redactResultForSink.js';

// steps
export { StepRunner, type ConditionSources, type StepRunnerOptions } from './steps/StepRunner.js';
export type { StepRunResult } from './steps/StepRunResult.js';
export type { StepContext, StepPosition } from './steps/StepContext.js';
export type { StepOutcome } from './steps/StepOutcome.js';
export type { Landing, Performed } from './steps/performAction.js';
export { SLOW_LOAD } from './steps/verifyCheckpoint.js';
export { RunState, type Drift } from './steps/RunState.js';

// errors
export { ReplayError, type ReplayErrorDetails, type ReplayErrorStep } from './errors/ReplayError.js';
export { ReplayOptionsError } from './errors/ReplayOptionsError.js';
export { ReplayStateError } from './errors/ReplayStateError.js';
export { CredentialNotFoundError } from './params/CredentialNotFoundError.js';
export { OutputParseError } from './outputs/OutputParseError.js';
export { toReplayError } from './errors/toReplayError.js';
