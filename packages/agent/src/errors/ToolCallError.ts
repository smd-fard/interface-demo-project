/** Stable codes of {@link ToolCallError}. */
export type ToolCallErrorCode = 'UNKNOWN_TOOL' | 'INVALID_INPUT' | 'UNKNOWN_PLACEHOLDER' | 'SENSITIVE_LITERAL';

/**
 * A tool call the agent cannot turn into an action: an unknown tool, an input that fails its schema, an unknown
 * `{{placeholder}}`, or a literal that contains a known sensitive value. The loop feeds it back to the model as
 * an error tool result, so its message never contains a concrete sensitive value.
 */
export class ToolCallError extends Error {
	constructor(
		readonly code: ToolCallErrorCode,
		readonly toolName: string,
		message: string,
	) {
		super(message);
		this.name = 'ToolCallError';
	}
}
