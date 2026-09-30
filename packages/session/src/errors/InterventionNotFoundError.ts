/** No intervention request with this id exists in the session. The control API answers it with 404. */
export class InterventionNotFoundError extends Error {
	readonly code = 'INTERVENTION_NOT_FOUND' as const;

	constructor(readonly requestId: string) {
		super(`no intervention request ${requestId}`);
		this.name = 'InterventionNotFoundError';
	}
}
