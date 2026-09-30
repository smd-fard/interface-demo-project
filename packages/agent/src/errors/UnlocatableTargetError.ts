/** The compiler cannot build a locator ladder for an element: nothing safe and stable identifies it. */
export class UnlocatableTargetError extends Error {
	readonly code = 'TARGET_UNLOCATABLE' as const;

	constructor(
		/** The element's role or tag (never its text, which may be sensitive). */
		readonly element: string,
	) {
		super(`no safe, stable locator for the ${element} element (its only identifying text is data or masked)`);
		this.name = 'UnlocatableTargetError';
	}
}
