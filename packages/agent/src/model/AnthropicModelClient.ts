import Anthropic from '@anthropic-ai/sdk';
import { MissingApiKeyError } from '../errors/MissingApiKeyError.js';
import { ModelCallError } from '../errors/ModelCallError.js';
import type { ModelClient, ModelRequest } from './ModelClient.js';
import type { ModelMessage } from './ModelMessage.js';
import type { ModelStopReason, ModelTurn } from './ModelTurn.js';

/** The model used when neither the `model` option nor `IDP_MODEL` names one. */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5';
/** Per-turn output bound: one tool call plus adaptive thinking fits well inside it. */
export const DEFAULT_MAX_TOKENS = 8192;

/** The `output_config.effort` levels the client may request. */
export type AnthropicEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Options of `AnthropicModelClient`; every field is optional (the key and model come from `env`). */
export interface AnthropicModelClientOptions {
	/** Where the key and `IDP_MODEL` are read from (default `process.env`). The key is never logged or echoed. */
	readonly env?: Readonly<Record<string, string | undefined>>;
	/** Overrides `IDP_MODEL`. */
	readonly model?: string;
	/** Upper bound on output tokens per turn (default 8192). */
	readonly maxTokens?: number;
	/** `output_config.effort`; omitted = the model's default. */
	readonly effort?: AnthropicEffort;
	/** SDK retries for 408/409/429/5xx and connection errors (default 2). */
	readonly maxRetries?: number;
	/** Per-request timeout in milliseconds (default 120 000). */
	readonly timeoutMs?: number;
}

const EPHEMERAL = { type: 'ephemeral' } as const;

const STOP_REASONS: Readonly<Record<string, ModelStopReason>> = {
	tool_use: 'tool_use',
	end_turn: 'end_turn',
	max_tokens: 'max_tokens',
	refusal: 'refusal',
};

function toMessageParam(message: ModelMessage): Anthropic.MessageParam {
	if (message.role === 'assistant') {
		if (Array.isArray(message.providerContent)) {
			return { role: 'assistant', content: message.providerContent as Anthropic.ContentBlockParam[] };
		}
		const content: Anthropic.ContentBlockParam[] = [];
		if (message.text !== '') content.push({ type: 'text', text: message.text });
		for (const call of message.toolCalls)
			content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
		return { role: 'assistant', content };
	}
	// Tool results must come first in a user turn; text (the new observation) follows.
	const results: Anthropic.ContentBlockParam[] = [];
	const texts: Anthropic.ContentBlockParam[] = [];
	for (const part of message.content) {
		if (part.kind === 'tool_result') {
			results.push({
				type: 'tool_result',
				tool_use_id: part.toolCallId,
				content: part.content,
				is_error: part.isError,
			});
		} else {
			texts.push({ type: 'text', text: part.text });
		}
	}
	return { role: 'user', content: [...results, ...texts] };
}

function isRetryable(status: number | undefined): boolean {
	return status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;
}

/**
 * The real model adapter: the `@anthropic-ai/sdk` Messages API with tool use. Prompt caching is on for the
 * system prompt, the tool list (a breakpoint on the last tool) and the growing conversation (top-level
 * automatic caching). Parallel tool use is off: the loop takes exactly one action per turn.
 *
 * Constructed only by `discover`; it fails fast with `MissingApiKeyError` when `ANTHROPIC_API_KEY` is unset.
 * SDK failures become a `ModelCallError` whose message never contains the key.
 */
export class AnthropicModelClient implements ModelClient {
	readonly modelId: string;
	readonly #model: string;
	readonly #client: Anthropic;
	readonly #apiKey: string;
	readonly #maxTokens: number;
	readonly #effort: AnthropicEffort | undefined;

	constructor(options: AnthropicModelClientOptions = {}) {
		const env = options.env ?? process.env;
		const apiKey = env['ANTHROPIC_API_KEY']?.trim() ?? '';
		if (apiKey === '') throw new MissingApiKeyError();
		const fromEnv = env['IDP_MODEL']?.trim();
		this.#model = options.model ?? (fromEnv === undefined || fromEnv === '' ? DEFAULT_ANTHROPIC_MODEL : fromEnv);
		this.modelId = `anthropic:${this.#model}`;
		this.#apiKey = apiKey;
		this.#maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
		this.#effort = options.effort;
		this.#client = new Anthropic({
			apiKey,
			maxRetries: options.maxRetries ?? 2,
			timeout: options.timeoutMs ?? 120_000,
		});
	}

	async next(request: ModelRequest): Promise<ModelTurn> {
		const lastTool = request.tools.length - 1;
		const tools: Anthropic.Tool[] = request.tools.map((tool, index) => ({
			name: tool.name,
			description: tool.description,
			input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
			...(index === lastTool ? { cache_control: EPHEMERAL } : {}),
		}));
		let message: Anthropic.Message;
		try {
			message = await this.#client.messages.create({
				model: this.#model,
				max_tokens: this.#maxTokens,
				system: [{ type: 'text', text: request.system, cache_control: EPHEMERAL }],
				messages: request.messages.map(toMessageParam),
				tools,
				tool_choice: { type: 'auto', disable_parallel_tool_use: true },
				cache_control: EPHEMERAL,
				...(this.#effort === undefined ? {} : { output_config: { effort: this.#effort } }),
			});
		} catch (error) {
			throw this.#callError(error);
		}
		return this.#toTurn(message);
	}

	#toTurn(message: Anthropic.Message): ModelTurn {
		const toolCalls: ModelTurn['toolCalls'][number][] = [];
		const texts: string[] = [];
		for (const block of message.content) {
			if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, input: block.input });
			else if (block.type === 'text') texts.push(block.text);
		}
		const usage = message.usage;
		return {
			toolCalls,
			text: texts.join('\n'),
			stopReason: (message.stop_reason === null ? undefined : STOP_REASONS[message.stop_reason]) ?? 'other',
			usage: {
				inputTokens: usage.input_tokens,
				outputTokens: usage.output_tokens,
				cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
				cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
			},
			providerContent: message.content,
		};
	}

	/** A typed error from whatever the SDK threw. The original is not attached: it may carry request headers. */
	#callError(error: unknown): ModelCallError {
		const status =
			typeof error === 'object' && error !== null && typeof (error as { status?: unknown }).status === 'number'
				? (error as { status: number }).status
				: undefined;
		const name = error instanceof Error ? error.name : 'UnknownError';
		const raw = error instanceof Error ? error.message : String(error);
		const message = raw.split(this.#apiKey).join('[REDACTED]').slice(0, 500);
		return new ModelCallError(
			`model call to ${this.#model} failed (${name}${status === undefined ? '' : `, HTTP ${status}`}): ${message}`,
			status,
			isRetryable(status),
		);
	}
}
