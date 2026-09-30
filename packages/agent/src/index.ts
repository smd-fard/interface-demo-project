// @idp/agent — the discovery side (R1, R2): the model port and its adapters, the agent tools (one per action
// kind), the placeholderized observation, the system prompt, the discovery loop and its trace, the artifact
// compiler, and the runner that composes them. The only package that imports the Anthropic SDK; replay never
// depends on it (invariant 1).

// the discovery run
export {
	DiscoveryRunner,
	STOP_FAILURE_REASONS,
	type DiscoveryRunnerOptions,
	type DiscoveryRunResult,
} from './DiscoveryRunner.js';
export {
	DiscoveryLoop,
	type DiscoveryLoopInput,
	type DiscoveryLoopOptions,
	type DiscoveryParam,
} from './loop/DiscoveryLoop.js';
export { STOP_REASONS, type DiscoveryOutcome, type StopReason } from './loop/DiscoveryOutcome.js';
export type { DiscoverySession } from './loop/DiscoverySession.js';
export { DEFAULT_STOP_OPTIONS, StopConditions, type ActionRecord, type StopOptions } from './loop/StopConditions.js';

// the trace
export type {
	DeclaredOutput,
	DiscoveryTrace,
	TraceAction,
	TraceFinish,
	TraceStep,
	TraceValue,
	TraceVerdict,
} from './trace/DiscoveryTrace.js';
export type { AddedElement, RouteChange, ScreenDiff, TitleChange } from './trace/ScreenDiff.js';
export { computeScreenDiff, type ComputeScreenDiffOptions } from './trace/computeScreenDiff.js';
export { safeFingerprint } from './trace/safeFingerprint.js';

// the compiler
export { ArtifactCompiler, type CompileOptions } from './compiler/ArtifactCompiler.js';
export { buildLocatorLadder, type BuildLocatorLadderOptions } from './compiler/buildLocatorLadder.js';
export { deriveCheckpoint, type CheckpointSubject, type DeriveCheckpointOptions } from './compiler/deriveCheckpoint.js';
export {
	assertNoConcreteValues,
	REDACTION_RULE_MATCH,
	type AssertNoConcreteValuesOptions,
	type ConcreteValues,
} from './compiler/assertNoConcreteValues.js';
export { containsValue, createTextGuard, type TextGuard } from './compiler/TextGuard.js';

// the model port
export type { ModelClient, ModelRequest } from './model/ModelClient.js';
export type { ModelMessage, ModelToolCall, ModelUserContent } from './model/ModelMessage.js';
export type { ModelToolSpec } from './model/ModelToolSpec.js';
export type { ModelStopReason, ModelTurn, ModelUsage } from './model/ModelTurn.js';

// model adapters
export {
	AnthropicModelClient,
	DEFAULT_ANTHROPIC_MODEL,
	DEFAULT_MAX_TOKENS,
	type AnthropicEffort,
	type AnthropicModelClientOptions,
} from './model/AnthropicModelClient.js';
export { ScriptedModel } from './model/ScriptedModel.js';
export {
	ModelScriptSchema,
	ScriptStepSchema,
	ScriptTargetSchema,
	type ModelScript,
	type ModelScriptInput,
	type ScriptStep,
	type ScriptTarget,
} from './model/ModelScript.js';

// tools
export {
	ACTION_TOOLS,
	AGENT_TOOLS,
	CONTROL_TOOL_NAMES,
	agentToolSpecs,
	type AgentToolDefinition,
	type ControlToolName,
} from './tools/toolDefinitions.js';
export { TOOL_INPUT_SCHEMAS, type AgentToolName } from './tools/toolInputSchemas.js';
export { toolToAction, type ToolCallContext } from './tools/toolToAction.js';
export type { ToolDecision } from './tools/ToolDecision.js';
export type { ValueSource } from './tools/ValueSource.js';
export type { CheckpointProposal } from './tools/CheckpointProposal.js';
export { CREDENTIAL_PLACEHOLDERS, type CredentialField } from './tools/credentialPlaceholders.js';

// observation and prompt
export {
	formatObservation,
	OBSERVATION_CLOSE,
	OBSERVATION_OPEN,
	type FormatObservationOptions,
} from './observe/formatObservation.js';
export { parseFormattedObservation, type ObservedElement } from './observe/parseFormattedObservation.js';
export { buildSystemPrompt, type PromptParam, type SystemPromptOptions } from './prompt/systemPrompt.js';

// errors
export { ArtifactCompileError, type ArtifactCompileErrorCode } from './errors/ArtifactCompileError.js';
export { ConcreteValueLeakError } from './errors/ConcreteValueLeakError.js';
export { UnparameterizedSensitiveValueError } from './errors/UnparameterizedSensitiveValueError.js';
export { DiscoveryConfigError } from './errors/DiscoveryConfigError.js';
export { UncheckpointableStepError } from './errors/UncheckpointableStepError.js';
export { UnlocatableTargetError } from './errors/UnlocatableTargetError.js';
export { MissingApiKeyError } from './errors/MissingApiKeyError.js';
export { ModelCallError } from './errors/ModelCallError.js';
export { ScriptError, type ScriptErrorCode } from './errors/ScriptError.js';
export { ToolCallError, type ToolCallErrorCode } from './errors/ToolCallError.js';
