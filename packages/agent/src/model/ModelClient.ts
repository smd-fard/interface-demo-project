import type { ModelMessage } from './ModelMessage.js';
import type { ModelToolSpec } from './ModelToolSpec.js';
import type { ModelTurn } from './ModelTurn.js';

/** One request to the model. Everything in it is already redacted and placeholderized (invariant 3). */
export interface ModelRequest {
	/** The system prompt (goal, tools, placeholders, rules). Stable across a run so it can be cached. */
	readonly system: string;
	readonly messages: readonly ModelMessage[];
	/** The tools, in a deterministic order (a stable prefix for prompt caching). */
	readonly tools: readonly ModelToolSpec[];
}

/** Per-call options: the loop passes its remaining time budget so a call cannot outlive the run (FR9). */
export interface ModelCallOptions {
	/** Aborted when the discovery time budget runs out; a client should stop the call (and its retries). */
	readonly signal?: AbortSignal;
	/** The remaining budget in ms; a client caps its per-request timeout at it. */
	readonly timeoutMs?: number;
}

/**
 * The model port of the discovery loop. `AnthropicModelClient` is the real adapter; `ScriptedModel` is the
 * deterministic fake used by tests and by keyless discovery. Only `@idp/agent` implements it; replay never
 * sees it (invariant 1).
 */
export interface ModelClient {
	/** A label for manifests and logs, e.g. `anthropic:claude-sonnet-5-5` or `scripted:member-lookup`. */
	readonly modelId: string;
	/**
	 * One model turn.
	 * @throws ModelCallError when the provider call fails after its retries (or is aborted by `options.signal`).
	 */
	next(request: ModelRequest, options?: ModelCallOptions): Promise<ModelTurn>;
}
