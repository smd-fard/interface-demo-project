/**
 * The operation does not fit the request: the wrong kind (approving a takeover, claiming an approval) or a
 * status it cannot move from (already claimed or resolved). Nothing changed. The control API answers it with 409.
 */
export class InterventionConflictError extends Error {
	readonly code = 'INTERVENTION_CONFLICT' as const;

	constructor(
		readonly requestId: string,
		readonly operation: string,
		readonly problem: 'wrong_kind' | 'wrong_status',
	) {
		super(`cannot ${operation} intervention request ${requestId}: ${problem.replace('_', ' ')}`);
		this.name = 'InterventionConflictError';
	}
}
