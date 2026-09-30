/**
 * The model's proof that the goal is met, given with `finish`. The loop verifies it on the live screen before it
 * accepts the finish; the compiler turns it into the artifact's final checkpoint.
 */
export type CheckpointProposal =
	| {
			readonly kind: 'text';
			readonly text: string;
			/** The frame path by frame names (e.g. `['content']`); omitted = any frame. */
			readonly frame?: readonly string[];
	  }
	| { readonly kind: 'element'; readonly ref: string };
