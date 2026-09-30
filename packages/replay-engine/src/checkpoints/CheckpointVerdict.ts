/** How a checkpoint verification ended. */
export type CheckpointVerdict =
	| { readonly kind: 'held' }
	/** A runtime condition was detected before the checkpoint held; the step runner consults the catalog. */
	| { readonly kind: 'condition'; readonly code: string }
	/** The checkpoint did not hold in time. `observed` comes from the surface and is redacted before any sink. */
	| { readonly kind: 'timeout'; readonly observed: string };
