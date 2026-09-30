/** A grant could not be minted: it names no step and no target, or its request id was already used. */
export class ApprovalGrantError extends Error {
	readonly code = 'APPROVAL_GRANT_INVALID' as const;

	constructor(
		readonly problem: 'unbound' | 'duplicate_request',
		readonly requestId: string,
	) {
		super(
			problem === 'unbound'
				? `grant for ${requestId} must be bound to a stepId or a fingerprintKey`
				: `a grant for ${requestId} was already minted`,
		);
		this.name = 'ApprovalGrantError';
	}
}
