// @idp/surface — the perception-and-action seam (R7.1): the `Surface` port, the Playwright web adapter
// behind it, and the locator ladder. Only plain types are exported; Playwright types stay internal. The
// functional-test harness lives in the `@idp/surface/testing` subpath.

// the port
export type { Surface } from './port/Surface.js';
export type { Bindings } from './port/Bindings.js';
export type {
	A11yNode,
	FrameInfo,
	FramePath,
	NavigationInfo,
	Observation,
	ObserveOptions,
} from './port/Observation.js';
export type { PendingDialog } from './port/PendingDialog.js';
export type { ContainerElementKind, ElementFingerprint } from './port/ElementFingerprint.js';
export type { Resolution } from './port/Resolution.js';
export type { CheckResult } from './port/CheckResult.js';
export type { ActOutcome } from './port/ActOutcome.js';
export type { EvidenceCapture } from './port/EvidenceCapture.js';
export type { SurfaceLocation } from './port/SurfaceLocation.js';
export type { ActionTarget, SurfaceAction, SurfaceActionOf } from './port/SurfaceAction.js';

// the policy guard (invariant 2)
export {
	PolicyGuardedSurface,
	type PolicyGuardedSurfaceOptions,
	type VerdictListener,
	type VerdictStage,
} from './guard/PolicyGuardedSurface.js';
export type { ApprovalGrant } from './guard/ApprovalGrant.js';
export {
	ApprovalGrantRegistry,
	consumeGrant,
	mintApprovalGrant,
	type ApprovalGrantRegistryOptions,
	type GrantBinding,
	type GrantCheck,
	type MintGrantRequest,
} from './guard/ApprovalGrantRegistry.js';
export { fingerprintKey } from './guard/fingerprintKey.js';
export { type GuardedActHooks } from './guard/PolicyGuardedSurface.js';

// the human-action recorder (mediated control, R6.2)
export {
	DEFAULT_BLOCK_MESSAGE,
	HumanActionRecorder,
	type HumanActionRecorderOptions,
	type RecordListener,
} from './recorder/HumanActionRecorder.js';
export type { HumanActionKind, RecordedHumanAction } from './recorder/RecordedHumanAction.js';
export type { DomEventDescriptor } from './recorder/DomEventDescriptor.js';
export { mapDomEventToStep, type RecordedGesture } from './recorder/mapDomEventToStep.js';
export { targetFromFingerprint } from './recorder/targetFromFingerprint.js';

// the web adapter
export { launchWebSurface } from './playwright/launchWebSurface.js';
export type { LaunchWebSurfaceOptions, WebSurfaceOptions, WebSurfaceSession } from './port/WebSurfaceOptions.js';
export type { BrowserHandle } from './port/BrowserHandle.js';

// pure helpers
export { buildA11yTree, parseAriaSnapshot, type FrameSnapshot, type RefTarget } from './snapshot/a11ySnapshot.js';
export { observationDigest } from './snapshot/observationDigest.js';
export { structuralXPath, xpathLiteral } from './locators/structuralXPath.js';
export { substituteTemplate } from './internal/substituteTemplate.js';
export { normalizeText } from './internal/normalizeText.js';
export { dialogMatches } from './dialogs/dialogMatches.js';

// errors
export { ApprovalGrantError } from './errors/ApprovalGrantError.js';
export {
	ApprovalRequiredError,
	type ApprovalRequiredDetails,
	type GrantRejection,
} from './errors/ApprovalRequiredError.js';
export { RecorderStateError } from './errors/RecorderStateError.js';
export { PolicyDeniedError, type PolicyDenialStage } from './errors/PolicyDeniedError.js';
export { ActionFailedError } from './errors/ActionFailedError.js';
export { DialogMismatchError } from './errors/DialogMismatchError.js';
export { DialogPendingError } from './errors/DialogPendingError.js';
export { NoDialogPendingError } from './errors/NoDialogPendingError.js';
export { OptionNotFoundError } from './errors/OptionNotFoundError.js';
export { WaitTimeoutError } from './errors/WaitTimeoutError.js';
export { BindingMissingError } from './errors/BindingMissingError.js';
export { FrameNotFoundError } from './errors/FrameNotFoundError.js';
export { NavigationBlockedError } from './errors/NavigationBlockedError.js';
export { SurfaceClosedError } from './errors/SurfaceClosedError.js';
export { SurfaceNotImplementedError } from './errors/SurfaceNotImplementedError.js';
export { TargetNotResolvedError, type RungObservation } from './errors/TargetNotResolvedError.js';
export { UnknownRefError } from './errors/UnknownRefError.js';
