// @idp/session — the live session controller (R6.1–R6.3): the control lease (FR20), the lease-checked surface,
// intervention requests, the localhost control API and client, and the live-session composition.

// the control lease
export {
	ControlLease,
	type AutomationActor,
	type ControlLeaseOptions,
	type LeaseHolder,
	type LeaseListener,
} from './lease/ControlLease.js';
export { LeasedSurface } from './lease/LeasedSurface.js';

// intervention requests
export {
	InterventionService,
	type GrantBindingInput,
	type InterventionResolution,
	type InterventionServiceOptions,
	type InterventionStep,
	type InterventionSubject,
	type RaiseInterventionInput,
} from './intervention/InterventionService.js';
export { redactInterventionRequest } from './intervention/redactInterventionRequest.js';

// the control API
export { ControlServer, type ControlServerOptions } from './control/ControlServer.js';
export { ControlClient, type ControlClientOptions, type ServedEvidence } from './control/ControlClient.js';
export type { ControlTarget } from './control/ControlTarget.js';
export type { LeaseView } from './control/LeaseView.js';

// the live session
export {
	LiveSession,
	openLiveSession,
	type ApprovalOutcome,
	type ApprovalStep,
	type EscalationOutcome,
	type InterventionCallOptions,
	type OpenLiveSessionOptions,
	type SessionHumanAction,
} from './LiveSession.js';

// errors
export { ControlApiError } from './errors/ControlApiError.js';
export { ControlServerStartError } from './errors/ControlServerStartError.js';
export { IllegalLeaseTransitionError, type LeaseOperation } from './errors/IllegalLeaseTransitionError.js';
export { InterventionConflictError } from './errors/InterventionConflictError.js';
export { InterventionNotFoundError } from './errors/InterventionNotFoundError.js';
export { InterventionTimeoutError } from './errors/InterventionTimeoutError.js';
export { LeaseNotHeldError } from './errors/LeaseNotHeldError.js';
export { SessionValidationError } from './errors/SessionValidationError.js';
