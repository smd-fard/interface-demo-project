/** The surface (browser, context or page) has been closed; no further call can succeed. */
export class SurfaceClosedError extends Error {
	readonly code = 'SURFACE_CLOSED' as const;

	constructor(message = 'the surface is closed', options?: ErrorOptions) {
		super(message, options);
		this.name = 'SurfaceClosedError';
	}
}
