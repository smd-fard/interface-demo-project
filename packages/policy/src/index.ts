// @idp/policy — the guardrails as pure functions: action registry and risk (invariant 2), allowlist
// evaluation, and redaction before any sink (invariant 3). No I/O.

// re-exported contracts
export { ACTION_KINDS, type ActionKind, RISK_ORDER, type RiskClass, maxRisk } from '@idp/artifact-schema';

// action registry and risk
export {
	ACTION_REGISTRY,
	type ActionPolicyEntry,
	type PayloadRedaction,
	isActionKind,
} from './actions/actionRegistry.js';
export { classifyRisk, type RiskClassification } from './risk/classifyRisk.js';

// config
export { resolvePolicy } from './config/resolvePolicy.js';
export type { ResolvedPolicy, ControlNameRule, IrreversibleRouteRule } from './config/ResolvedPolicy.js';
export { compileRouteGlob, type RouteMatcher } from './config/matchRouteGlob.js';
export { PolicyConfigError, type PolicyConfigErrorCode } from './errors/PolicyConfigError.js';

// evaluation
export type { ActionIntent, KnownActionIntent, PolicyActor } from './intent/ActionIntent.js';
export type {
	AllowVerdict,
	DenyCode,
	DenyVerdict,
	LandingVerdict,
	PolicyVerdict,
	RequireApprovalVerdict,
} from './verdict/PolicyVerdict.js';
export { evaluateAction } from './evaluate/evaluateAction.js';
export { evaluateLanding } from './evaluate/evaluateLanding.js';

// redaction
export type { Redacted } from './redaction/Redacted.js';
export { asMaskedScreenshot, type MaskedScreenshot } from './redaction/MaskedScreenshot.js';
export type { RedactionConfig } from './redaction/RedactionConfig.js';
export { DEFAULT_REDACTION_CONFIG, REDACTION_RULES_VERSION } from './redaction/defaultRedactionRules.js';
export {
	createRedactor,
	FULL_MASK,
	type CreateRedactorOptions,
	type Redactor,
	type SensitiveValueInput,
} from './redaction/createRedactor.js';
