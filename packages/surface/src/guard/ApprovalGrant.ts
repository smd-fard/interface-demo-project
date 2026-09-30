/**
 * A human approval for one irreversible action, minted by the session when an operator approves an
 * intervention (`ApprovalGrantRegistry.mint`). It is bound to the step (`stepId`) or the resolved target
 * (`fingerprintKey`), single-use and short-lived. The policy-guarded surface consumes it; a raw surface only
 * honours its presence (a grant makes the click accept its own `confirm`).
 */
export interface ApprovalGrant {
	/** The intervention request the approval answers. */
	readonly requestId: string;
	/** The step the approval covers (replay). */
	readonly stepId?: string;
	/** `fingerprintKey(fingerprint)` of the approved target (agent, human). */
	readonly fingerprintKey?: string;
	/** ISO-8601 instants from the injected clock. */
	readonly issuedAt: string;
	readonly expiresAt: string;
	/** Who approved (an operator id; never a secret). */
	readonly grantedBy: string;
}
