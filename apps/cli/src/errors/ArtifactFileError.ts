/** Stable codes of {@link ArtifactFileError}. */
export type ArtifactFileErrorCode = 'artifact_not_found' | 'artifact_invalid';

/**
 * The artifact file given to `replay` cannot be read, is not JSON or is not a capability artifact. Raised before
 * any browser starts. (A content-hash mismatch is left to the replay engine, which reports it as a `failure`.)
 */
export class ArtifactFileError extends Error {
	constructor(
		readonly code: ArtifactFileErrorCode,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = 'ArtifactFileError';
	}
}
