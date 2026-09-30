import type { ModelToolCall } from './ModelMessage.js';

/** Why the model stopped: provider stop reasons mapped to a small neutral set. */
export type ModelStopReason = 'tool_use' | 'end_turn' | 'max_tokens' | 'refusal' | 'other';

/** Token accounting for one call (zeros for the scripted model). */
export interface ModelUsage {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheReadInputTokens: number;
	readonly cacheCreationInputTokens: number;
}

/** One model turn: the tool calls it asked for (the loop acts on the first), its text, and why it stopped. */
export interface ModelTurn {
	readonly toolCalls: readonly ModelToolCall[];
	readonly text: string;
	readonly stopReason: ModelStopReason;
	readonly usage: ModelUsage;
	/** Provider content blocks to echo back in the assistant message (see `ModelMessage`). */
	readonly providerContent?: unknown;
}
