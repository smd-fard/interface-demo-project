/** Stable codes of {@link ScriptError}. */
export type ScriptErrorCode =
	'SCRIPT_INVALID' | 'SCRIPT_EXHAUSTED' | 'SCRIPT_TARGET_NOT_FOUND' | 'SCRIPT_NO_OBSERVATION';

/** A model script cannot be loaded or played (invalid file, no step left, a target not on screen). */
export class ScriptError extends Error {
	constructor(
		readonly code: ScriptErrorCode,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = 'ScriptError';
	}
}
