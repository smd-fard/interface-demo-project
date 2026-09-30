/** A `wait` action's checkpoint did not hold within its timeout. */
export class WaitTimeoutError extends Error {
	readonly code = 'WAIT_TIMEOUT' as const;

	constructor(
		readonly timeoutMs: number,
		/** What was on screen instead (the checkpoint's `observed`: templates, paths and titles, never values). */
		readonly observed: string,
	) {
		super(`wait timed out after ${timeoutMs} ms: ${observed}`);
		this.name = 'WaitTimeoutError';
	}
}
