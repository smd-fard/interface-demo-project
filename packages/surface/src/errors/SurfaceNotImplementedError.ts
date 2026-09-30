/** A port operation whose implementation belongs to a later build step (a deliberate, typed seam). */
export class SurfaceNotImplementedError extends Error {
	readonly code = 'SURFACE_NOT_IMPLEMENTED' as const;

	constructor(readonly operation: string) {
		super(`${operation} is not implemented yet`);
		this.name = 'SurfaceNotImplementedError';
	}
}
