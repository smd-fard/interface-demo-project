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

/** Provider metadata of the response behind a turn (FR10): logged with the turn's `decision`. */
export interface ModelResponseInfo {
	/** The provider response id (`msg_…`); `scripted-<n>` for the scripted model. */
	readonly id: string;
	/** The model the provider says answered (may differ from the requested alias). */
	readonly model: string;
	/** The provider's own stop reason, unmapped (e.g. `tool_use`, `pause_turn`). */
	readonly stopReason: string;
}

/** One model turn: the tool calls it asked for (the loop acts on the first), its text, and why it stopped. */
export interface ModelTurn {
	readonly toolCalls: readonly ModelToolCall[];
	readonly text: string;
	readonly stopReason: ModelStopReason;
	readonly usage: ModelUsage;
	/** Response metadata; omitted by a fake that has none. */
	readonly response?: ModelResponseInfo;
	/** Provider content blocks to echo back in the assistant message (see `ModelMessage`). */
	readonly providerContent?: unknown;
}
