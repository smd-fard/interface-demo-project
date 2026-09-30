import type { LeaseState } from '@idp/artifact-schema';

/**
 * An actor tried to act on the live session without holding the control lease (FR20): the automation
 * (`agent` / `replay`) needs `AGENT`, a human needs `HUMAN`. Nothing was performed.
 */
export class LeaseNotHeldError extends Error {
	readonly code = 'LEASE_NOT_HELD' as const;

	constructor(
		readonly actor: 'agent' | 'replay' | 'human',
		readonly state: LeaseState,
	) {
		super(`${actor} may not act: the control lease is ${state}`);
		this.name = 'LeaseNotHeldError';
	}
}
