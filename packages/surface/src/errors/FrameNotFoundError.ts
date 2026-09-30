/** A frame scope hop matched no frame (or more than one) under the current frame. */
export class FrameNotFoundError extends Error {
	readonly code = 'FRAME_NOT_FOUND' as const;

	constructor(
		/** The index of the hop that failed. */
		readonly hopIndex: number,
		/** A description of the hop, e.g. `by_name "content"`. */
		readonly hop: string,
		/** How many child frames matched the hop (0 or more than 1). */
		readonly matches: number,
	) {
		super(`frame hop ${hopIndex} (${hop}) matched ${matches} frames`);
		this.name = 'FrameNotFoundError';
	}
}
