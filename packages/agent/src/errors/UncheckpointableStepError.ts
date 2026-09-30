/**
 * A screen-changing step left no verifiable change on screen (no new title, heading, element or route), so
 * the compiler cannot give it a checkpoint and refuses to compile it (invariant 5: "the click did not throw"
 * is not success).
 */
export class UncheckpointableStepError extends Error {
	readonly code = 'STEP_UNCHECKPOINTABLE' as const;

	constructor(
		/** The trace step index. */
		readonly stepIndex: number,
		readonly actionKind: string,
	) {
		super(`trace step ${stepIndex} (${actionKind}) changed nothing verifiable on screen; it cannot be checkpointed`);
		this.name = 'UncheckpointableStepError';
	}
}
