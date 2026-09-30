/**
 * Whether a browser error only says the frame (or page) went away while we worked on it — it navigated,
 * detached or closed — so whatever we left in its document went with it. Anything else is a real error.
 */
export function isGoneFrameError(error: unknown): boolean {
	return (
		error instanceof Error &&
		/Execution context was destroyed|Frame was detached|frame got detached|Target page, context or browser has been closed/i.test(
			error.message,
		)
	);
}
