import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MissingApiKeyError } from '../errors/MissingApiKeyError.js';
import { ModelCallError } from '../errors/ModelCallError.js';
import { AnthropicModelClient } from './AnthropicModelClient.js';
import type { ModelRequest } from './ModelClient.js';

// The SDK is mocked at the module boundary: no client is ever built for real, no request leaves the process.
const sdk = vi.hoisted(() => ({ create: vi.fn(), constructed: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
	default: class {
		readonly messages = { create: sdk.create };
		constructor(options: unknown) {
			sdk.constructed(options);
		}
	},
}));

const KEY = 'sk-ant-test-not-a-real-key';
const env = { ANTHROPIC_API_KEY: KEY };

const request: ModelRequest = {
	system: 'SYSTEM PROMPT',
	tools: [
		{ name: 'click', description: 'Click.', inputSchema: { type: 'object', properties: {} } },
		{ name: 'finish', description: 'Finish.', inputSchema: { type: 'object', properties: {} } },
	],
	messages: [
		{ role: 'user', content: [{ kind: 'text', text: '<observation>…</observation>' }] },
		{ role: 'assistant', text: 'clicking', toolCalls: [{ id: 'toolu_1', name: 'click', input: { ref: 'e1' } }] },
		{
			role: 'user',
			content: [
				{ kind: 'text', text: '<observation>2</observation>' },
				{ kind: 'tool_result', toolCallId: 'toolu_1', content: 'ok', isError: false },
			],
		},
	],
};

function response(overrides: Record<string, unknown> = {}) {
	return {
		id: 'msg_1',
		type: 'message',
		role: 'assistant',
		model: 'claude-sonnet-5-5',
		content: [
			{ type: 'thinking', thinking: '', signature: 'sig' },
			{ type: 'text', text: 'I will search.' },
			{ type: 'tool_use', id: 'toolu_2', name: 'click', input: { ref: 'e7', reason: 'search' } },
		],
		stop_reason: 'tool_use',
		usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 100, cache_creation_input_tokens: null },
		...overrides,
	};
}

beforeEach(() => {
	sdk.create.mockReset();
	sdk.constructed.mockReset();
});

describe('AnthropicModelClient', () => {
	it('fails fast with MissingApiKeyError when no key is set, before building an SDK client', () => {
		for (const missing of [{}, { ANTHROPIC_API_KEY: '' }, { ANTHROPIC_API_KEY: '   ' }]) {
			expect(() => new AnthropicModelClient({ env: missing })).toThrow(MissingApiKeyError);
		}
		expect(sdk.constructed).not.toHaveBeenCalled();
		const error = new MissingApiKeyError();
		expect(error.code).toBe('MISSING_API_KEY');
		expect(error.message).toContain('--model scripted:<file>');
	});

	it('passes the key from the injected env to the SDK and defaults to claude-sonnet-5-5', () => {
		const client = new AnthropicModelClient({ env });
		expect(sdk.constructed).toHaveBeenCalledWith(expect.objectContaining({ apiKey: KEY }));
		expect(client.modelId).toBe('anthropic:claude-sonnet-5-5');
		expect(new AnthropicModelClient({ env: { ...env, IDP_MODEL: 'claude-opus-5-5' } }).modelId).toBe(
			'anthropic:claude-opus-5-5',
		);
		expect(
			new AnthropicModelClient({ env: { ...env, IDP_MODEL: 'claude-opus-5-5' }, model: 'claude-haiku-4-5' }).modelId,
		).toBe('anthropic:claude-haiku-4-5');
	});

	it('sends a bounded, cached, one-tool-per-turn Messages request', async () => {
		sdk.create.mockResolvedValue(response());
		await new AnthropicModelClient({ env }).next(request);
		expect(sdk.create).toHaveBeenCalledTimes(1);
		const params = sdk.create.mock.calls[0]?.[0] as Record<string, unknown>;
		expect(params).toMatchObject({
			model: 'claude-sonnet-5-5',
			max_tokens: 8192,
			system: [{ type: 'text', text: 'SYSTEM PROMPT', cache_control: { type: 'ephemeral' } }],
			tool_choice: { type: 'auto', disable_parallel_tool_use: true },
			cache_control: { type: 'ephemeral' },
		});
		expect(params['tools']).toEqual([
			{ name: 'click', description: 'Click.', input_schema: { type: 'object', properties: {} } },
			{
				name: 'finish',
				description: 'Finish.',
				input_schema: { type: 'object', properties: {} },
				cache_control: { type: 'ephemeral' },
			},
		]);
		expect(params['messages']).toEqual([
			{ role: 'user', content: [{ type: 'text', text: '<observation>…</observation>' }] },
			{
				role: 'assistant',
				content: [
					{ type: 'text', text: 'clicking' },
					{ type: 'tool_use', id: 'toolu_1', name: 'click', input: { ref: 'e1' } },
				],
			},
			{
				role: 'user',
				content: [
					{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok', is_error: false },
					{ type: 'text', text: '<observation>2</observation>' },
				],
			},
		]);
		expect(JSON.stringify(params)).not.toContain(KEY);
	});

	it('honours maxTokens and effort options', async () => {
		sdk.create.mockResolvedValue(response());
		await new AnthropicModelClient({ env, maxTokens: 2048, effort: 'low' }).next(request);
		expect(sdk.create.mock.calls[0]?.[0]).toMatchObject({ max_tokens: 2048, output_config: { effort: 'low' } });
	});

	it('maps the response: tool_use blocks, text, stop reason, usage, and the blocks to echo back', async () => {
		sdk.create.mockResolvedValue(response());
		const turn = await new AnthropicModelClient({ env }).next(request);
		expect(turn).toEqual({
			toolCalls: [{ id: 'toolu_2', name: 'click', input: { ref: 'e7', reason: 'search' } }],
			text: 'I will search.',
			stopReason: 'tool_use',
			usage: { inputTokens: 120, outputTokens: 30, cacheReadInputTokens: 100, cacheCreationInputTokens: 0 },
			providerContent: response().content,
		});
	});

	it('echoes providerContent verbatim for an assistant turn (keeps thinking blocks valid)', async () => {
		sdk.create.mockResolvedValue(response());
		const blocks = response().content;
		await new AnthropicModelClient({ env }).next({
			...request,
			messages: [
				{ role: 'user', content: [{ kind: 'text', text: 'go' }] },
				{ role: 'assistant', text: 'x', toolCalls: [], providerContent: blocks },
			],
		});
		const params = sdk.create.mock.calls[0]?.[0] as { messages: unknown[] };
		expect(params.messages[1]).toEqual({ role: 'assistant', content: blocks });
	});

	it.each([
		['end_turn', 'end_turn'],
		['max_tokens', 'max_tokens'],
		['refusal', 'refusal'],
		['pause_turn', 'other'],
		[null, 'other'],
	])('maps stop_reason %s to %s', async (stop, expected) => {
		sdk.create.mockResolvedValue(response({ stop_reason: stop, content: [{ type: 'text', text: 'done' }] }));
		const turn = await new AnthropicModelClient({ env }).next(request);
		expect(turn.stopReason).toBe(expected);
		expect(turn.toolCalls).toEqual([]);
	});

	it('maps SDK errors to ModelCallError without the key', async () => {
		const failure = Object.assign(new Error(`401 invalid x-api-key ${KEY}`), { status: 401 });
		sdk.create.mockRejectedValue(failure);
		const error = await new AnthropicModelClient({ env }).next(request).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(ModelCallError);
		expect(error).toMatchObject({ code: 'MODEL_CALL_FAILED', status: 401, retryable: false });
		expect((error as Error).message).not.toContain(KEY);
		expect((error as Error).cause).toBeUndefined();

		sdk.create.mockRejectedValue(Object.assign(new Error('overloaded'), { status: 529 }));
		expect(await new AnthropicModelClient({ env }).next(request).catch((caught: unknown) => caught)).toMatchObject({
			status: 529,
			retryable: true,
		});
		sdk.create.mockRejectedValue(new Error('Connection error.'));
		expect(await new AnthropicModelClient({ env }).next(request).catch((caught: unknown) => caught)).toMatchObject({
			status: undefined,
			retryable: true,
		});
	});
});
