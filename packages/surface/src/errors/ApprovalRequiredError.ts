import type { ElementFingerprint } from '../port/ElementFingerprint.js';

/** Why a grant presented with an irreversible action was not accepted. */
export type GrantRejection = 'unknown' | 'reused' | 'expired' | 'mismatch';

/** What `ApprovalRequiredError` carries so the session can raise an intervention request and bind a grant. */
export interface ApprovalRequiredDetails {
	readonly actionKind: string;
	readonly reason: string;
	readonly stepId?: string;
	/** The resolved target, so the session can bind a grant to it (`fingerprintKey`). */
	readonly fingerprint?: ElementFingerprint;
	/** Set when the action carried a grant that was rejected. */
	readonly grantRejection?: GrantRejection;
}

/**
 * The action is irreversible and carried no valid approval grant, so the surface did not act. The session
 * turns this into an intervention request; a human approval mints a single-use grant bound to the same
 * stepId or target. `reason` names rule sources only; the fingerprint holds UI text — redact before any sink.
 */
export class ApprovalRequiredError extends Error {
	readonly code = 'APPROVAL_REQUIRED' as const;
	readonly risk = 'irreversible' as const;
	readonly actionKind: string;
	readonly reason: string;
	readonly stepId: string | undefined;
	readonly fingerprint: ElementFingerprint | undefined;
	readonly grantRejection: GrantRejection | undefined;

	constructor(details: ApprovalRequiredDetails) {
		super(
			`${details.actionKind} requires approval (irreversible)${
				details.grantRejection === undefined ? '' : `; the grant was rejected (${details.grantRejection})`
			}`,
		);
		this.name = 'ApprovalRequiredError';
		this.actionKind = details.actionKind;
		this.reason = details.reason;
		this.stepId = details.stepId;
		this.fingerprint = details.fingerprint;
		this.grantRejection = details.grantRejection;
	}
}
