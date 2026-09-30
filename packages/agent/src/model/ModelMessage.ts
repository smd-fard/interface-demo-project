/** One tool call the model asked for. `input` is the raw, unvalidated JSON object the model produced. */
export interface ModelToolCall {
	/** The provider's id for the call; the matching tool result must carry it. */
	readonly id: string;
	readonly name: string;
	readonly input: unknown;
}

/** User-side content: text (an observation, the goal) or the result of an earlier tool call. */
export type ModelUserContent =
	| { readonly kind: 'text'; readonly text: string }
	| {
			readonly kind: 'tool_result';
			readonly toolCallId: string;
			/** What happened, already redacted and placeholderized by the loop (invariant 3). */
			readonly content: string;
			/** True when the call was refused or failed (unknown tool, invalid input, policy denial, …). */
			readonly isError: boolean;
	  };

/**
 * A provider-neutral conversation message. The loop owns the transcript; every string in it has passed through
 * the redactor before it is appended (invariant 3).
 */
export type ModelMessage =
	| { readonly role: 'user'; readonly content: readonly ModelUserContent[] }
	| {
			readonly role: 'assistant';
			readonly text: string;
			readonly toolCalls: readonly ModelToolCall[];
			/**
			 * The provider's own content blocks for this turn (e.g. Anthropic thinking + tool_use blocks), echoed back
			 * verbatim on the next request so provider-side state such as thinking blocks stays valid. Opaque here.
			 */
			readonly providerContent?: unknown;
	  };
