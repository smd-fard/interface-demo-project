import type { InterventionRequest, OperatorActor } from '@idp/artifact-schema';
import type { StoredEvidence } from '@idp/evidence';
import type { LeaseView } from './LeaseView.js';

/**
 * What the control server drives: a live session (or a fake in tests). Everything it returns is already
 * redacted — intervention requests are stored redacted, lease reasons are redacted, evidence is masked.
 * Operations throw the session's typed errors (`IllegalLeaseTransitionError`, `InterventionNotFoundError`,
 * `InterventionConflictError`, `SessionValidationError`), which the server maps to HTTP statuses.
 */
export interface ControlTarget {
	lease(): LeaseView;
	interventions(): readonly InterventionRequest[];
	intervention(id: string): InterventionRequest | undefined;
	/** A stored evidence file by ref id; the server decides whether it may be served. */
	evidence(refId: string): StoredEvidence | undefined;
	/** Takeover: cede the lease to the operator (and bring the window to the front). */
	claim(id: string, operator: OperatorActor): Promise<InterventionRequest>;
	/** Approval: mint a grant and move the lease to RESUMING. */
	approve(id: string, operator: OperatorActor): Promise<InterventionRequest>;
	/** Approval: refuse; the lease closes. */
	reject(id: string, operator: OperatorActor): Promise<InterventionRequest>;
	/** Hand control back: HUMAN → RESUMING. */
	resume(operator: OperatorActor): Promise<LeaseView>;
	/** End the run: the lease closes and open requests are aborted. */
	abort(operator: OperatorActor): Promise<LeaseView>;
}
