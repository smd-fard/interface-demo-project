import type { LeaseState } from '@idp/artifact-schema';

/** The lease operations; each is legal from exactly one state (`close` from any). */
export type LeaseOperation = 'pause' | 'cede' | 'approve' | 'reject' | 'resume' | 'reacquire' | 'close';

/**
 * A lease operation was attempted from a state it is not legal from (e.g. `resume` while `PAUSED`). The lease
 * did not change. The control API answers it with 409.
 */
export class IllegalLeaseTransitionError extends Error {
	readonly code = 'ILLEGAL_LEASE_TRANSITION' as const;

	constructor(
		readonly from: LeaseState,
		readonly attempted: LeaseOperation,
	) {
		super(`cannot ${attempted} the control lease from ${from}`);
		this.name = 'IllegalLeaseTransitionError';
	}
}
