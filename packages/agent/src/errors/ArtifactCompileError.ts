/** Stable codes of {@link ArtifactCompileError}. */
export type ArtifactCompileErrorCode = 'GOAL_NOT_MET' | 'NO_STEPS' | 'INVALID_ARTIFACT' | 'UNSUPPORTED_OUTPUT_TYPE';

/**
 * The compiler cannot produce an artifact: the run did not meet its goal (only `goal_met` compiles, FR6), no
 * performed step is left, an output has a type no extract parse produces (`boolean`), or the result fails the
 * artifact schema (the message lists paths, never values).
 */
export class ArtifactCompileError extends Error {
	constructor(
		readonly code: ArtifactCompileErrorCode,
		message: string,
	) {
		super(message);
		this.name = 'ArtifactCompileError';
	}
}
