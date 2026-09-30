/** Nobody resolved the intervention request in time. The request stays open; the lease stays where it was. */
export class InterventionTimeoutError extends Error {
	readonly code = 'INTERVENTION_TIMEOUT' as const;

	constructor(
		readonly requestId: string,
		readonly timeoutMs: number,
	) {
		super(`intervention request ${requestId} was not resolved within ${timeoutMs} ms`);
		this.name = 'InterventionTimeoutError';
	}
}
