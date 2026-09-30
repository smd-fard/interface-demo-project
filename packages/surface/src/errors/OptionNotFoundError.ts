/** A `select` action named an option that is neither an option label nor an option value of the dropdown. */
export class OptionNotFoundError extends Error {
	readonly code = 'OPTION_NOT_FOUND' as const;

	constructor(
		/** The target's description (never a selector). */
		readonly target: string,
		/** How many options the dropdown offers. The requested option is not echoed: it may be a param value. */
		readonly optionCount: number,
	) {
		super(`no option of "${target}" matches the requested label or value (${optionCount} options)`);
		this.name = 'OptionNotFoundError';
	}
}
