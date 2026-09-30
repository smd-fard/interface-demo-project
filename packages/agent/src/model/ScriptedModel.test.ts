import { createRedactor } from '@idp/policy';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ScriptError } from '../errors/ScriptError.js';
import { detailObservation, loginObservation } from '../observe/fixtures/observations.js';
import { formatObservation } from '../observe/formatObservation.js';
import type { ModelMessage } from './ModelMessage.js';
import type { ModelRequest } from './ModelClient.js';
import type { ModelScriptInput } from './ModelScript.js';
import { ScriptedModel } from './ScriptedModel.js';

const redactor = createRedactor({
	sensitiveValues: [{ value: '12345', paramName: 'memberId' }, 'teller01', 'synthetic-pass-01'],
});
const loginScreen = formatObservation(loginObservation(), { redactor });
const detailScreen = formatObservation(detailObservation(), { redactor });

function request(screen: string | undefined, extra: ModelMessage[] = []): ModelRequest {
	const messages: ModelMessage[] = [...extra];
	if (screen !== undefined) messages.push({ role: 'user', content: [{ kind: 'text', text: screen }] });
	return { system: 'system prompt', messages, tools: [] };
}

function refOf(screen: string, pattern: RegExp): string {
	const line = screen.split('\n').find((candidate) => pattern.test(candidate));
	const ref = /\[(e\d+)\]/.exec(line ?? '')?.[1];
	if (ref === undefined) throw new Error(`no line matches ${String(pattern)}`);
	return ref;
}

async function scriptError(promise: Promise<unknown>): Promise<ScriptError> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof ScriptError) return error;
		throw error;
	}
	throw new Error('expected a ScriptError');
}

const script = (steps: ModelScriptInput['steps'], rest: Partial<ModelScriptInput> = {}): ModelScriptInput => ({
	scriptVersion: 1,
	name: 'test',
	steps,
	...rest,
});

describe('ScriptedModel', () => {
	it('resolves {role, label, frame} and {role, name} targets to refs of the latest observation', async () => {
		const model = new ScriptedModel(
			script([
				{
					tool: 'fill',
					target: { role: 'textbox', label: 'User ID', frame: 'content' },
					input: { value: '{{credential.username}}', reason: 'r' },
				},
				{ tool: 'click', target: { role: 'link', name: 'Sign Off' }, input: { reason: 'r' }, text: 'bye' },
			]),
		);
		const first = await model.next(request(loginScreen));
		expect(first).toMatchObject({ stopReason: 'tool_use', text: '' });
		expect(first.toolCalls).toEqual([
			{
				id: 'toolu_scripted_001',
				name: 'fill',
				input: { value: '{{credential.username}}', reason: 'r', ref: refOf(loginScreen, /- textbox .*"User ID"/) },
			},
		]);
		const second = await model.next(request(loginScreen));
		expect(second.text).toBe('bye');
		expect(second.toolCalls[0]).toMatchObject({
			id: 'toolu_scripted_002',
			input: { ref: refOf(loginScreen, /"Sign Off"/) },
		});
		expect(second.usage).toEqual({
			inputTokens: 0,
			outputTokens: 0,
			cacheReadInputTokens: 0,
			cacheCreationInputTokens: 0,
		});
	});

	it('reads the observation from the last message that has one, including tool results', async () => {
		const model = new ScriptedModel(
			script([{ tool: 'extract', target: { role: 'cell', label: 'Share Savings' }, input: {} }]),
		);
		const turn = await model.next(
			request(undefined, [
				{ role: 'user', content: [{ kind: 'text', text: loginScreen }] },
				{ role: 'assistant', text: '', toolCalls: [{ id: 'a', name: 'click', input: {} }] },
				{
					role: 'user',
					content: [{ kind: 'tool_result', toolCallId: 'a', content: `ok\n${detailScreen}`, isError: false }],
				},
			]),
		);
		expect(turn.toolCalls[0]?.input).toMatchObject({ ref: refOf(detailScreen, /label: "Share Savings"/) });
	});

	it('scripts wrong behaviour: repeats, fixed refs, unknown tools, early finish, request_help', async () => {
		const model = new ScriptedModel(
			script([
				{ tool: 'click', target: { ref: 'e999' }, input: { reason: 'stale' }, repeat: 3 },
				{ tool: 'teleport', input: { reason: 'r' } },
				{ tool: 'request_help', input: { reason: 'stuck' } },
			]),
		);
		const names: string[] = [];
		for (let turn = 0; turn < 5; turn += 1) {
			const next = await model.next(request(loginScreen));
			names.push(`${next.toolCalls[0]?.name}:${String((next.toolCalls[0]?.input as { ref?: string }).ref)}`);
		}
		expect(names).toEqual(['click:e999', 'click:e999', 'click:e999', 'teleport:undefined', 'request_help:undefined']);
		expect(model.done).toBe(true);
	});

	it('handles exhaustion as configured: error, end_turn or loop', async () => {
		const erroring = new ScriptedModel(script([{ tool: 'request_help', input: { reason: 'r' } }]));
		await erroring.next(request(loginScreen));
		expect((await scriptError(erroring.next(request(loginScreen)))).code).toBe('SCRIPT_EXHAUSTED');

		const ending = new ScriptedModel(
			script([{ tool: 'request_help', input: { reason: 'r' } }], { onExhausted: 'end_turn' }),
		);
		await ending.next(request(loginScreen));
		expect(await ending.next(request(loginScreen))).toMatchObject({ toolCalls: [], stopReason: 'end_turn' });

		const looping = new ScriptedModel(
			script(
				[
					{ tool: 'navigate', input: { route: '/', reason: 'r' } },
					{ tool: 'click', target: { ref: 'e1' }, input: { reason: 'a' } },
					{ tool: 'click', target: { ref: 'e2' }, input: { reason: 'b' } },
				],
				{ onExhausted: 'loop', loopFrom: 1 },
			),
		);
		const refs: unknown[] = [];
		for (let turn = 0; turn < 7; turn += 1) {
			refs.push(((await looping.next(request(loginScreen))).toolCalls[0]?.input as { ref?: string }).ref);
		}
		expect(refs).toEqual([undefined, 'e1', 'e2', 'e1', 'e2', 'e1', 'e2']);
	});

	it('records every request it received as an independent copy', async () => {
		const model = new ScriptedModel(script([{ tool: 'request_help', input: { reason: 'r' } }]));
		const sent = request(detailScreen);
		await model.next(sent);
		expect(model.requests).toHaveLength(1);
		expect(model.requests[0]).toEqual(sent);
		expect(model.requests[0]).not.toBe(sent);
		expect(JSON.stringify(model.requests)).not.toContain('12345');
	});

	it('fails with typed errors: invalid script, target not on screen, no observation', async () => {
		expect(() => new ScriptedModel({ scriptVersion: 2, name: 'x', steps: [] } as unknown as ModelScriptInput)).toThrow(
			expect.objectContaining({ code: 'SCRIPT_INVALID' }),
		);
		const missing = new ScriptedModel(
			script([{ tool: 'click', target: { role: 'button', name: 'Launch' }, input: {} }]),
		);
		expect((await scriptError(missing.next(request(loginScreen)))).code).toBe('SCRIPT_TARGET_NOT_FOUND');
		const blind = new ScriptedModel(
			script([{ tool: 'click', target: { role: 'button', name: 'Sign On' }, input: {} }]),
		);
		expect((await scriptError(blind.next(request(undefined)))).code).toBe('SCRIPT_NO_OBSERVATION');
	});

	it('is labelled scripted:<name>', () => {
		expect(new ScriptedModel(script([{ tool: 'finish', input: {} }], { name: 'demo' })).modelId).toBe('scripted:demo');
	});
});

describe('bundled scripts', () => {
	const path = (name: string) => fileURLToPath(new URL(`../../scripts/${name}.script.json`, import.meta.url));

	it.each(['member-lookup', 'open-sub-account'])('%s loads, validates and holds placeholders only', async (name) => {
		const model = await ScriptedModel.fromFile(path(name));
		expect(model.modelId).toBe(`scripted:${name}`);
		const { readFile } = await import('node:fs/promises');
		const raw = await readFile(path(name), 'utf8');
		for (const value of ['12345', 'teller01', 'synthetic-pass-01', 'Jane Sample']) expect(raw).not.toContain(value);
		expect(raw).toContain('{{credential.password}}');
		expect(raw).toContain('{{memberId}}');
	});

	it('member-lookup signs on against the real login observation', async () => {
		const model = await ScriptedModel.fromFile(path('member-lookup'));
		const navigate = await model.next(request(loginScreen));
		expect(navigate.toolCalls[0]).toMatchObject({ name: 'navigate', input: { route: '/' } });
		const user = await model.next(request(loginScreen));
		expect(user.toolCalls[0]).toMatchObject({
			name: 'fill',
			input: { ref: refOf(loginScreen, /- textbox .*"User ID"/), value: '{{credential.username}}' },
		});
		const password = await model.next(request(loginScreen));
		expect(password.toolCalls[0]?.input).toMatchObject({ ref: refOf(loginScreen, /- textbox .*"Password"/) });
		const signOn = await model.next(request(loginScreen));
		expect(signOn.toolCalls[0]?.input).toMatchObject({ ref: refOf(loginScreen, /- button "Sign On"/) });
	});

	it('rejects a missing script file as SCRIPT_INVALID', async () => {
		expect((await scriptError(ScriptedModel.fromFile(path('nope')))).code).toBe('SCRIPT_INVALID');
	});
});
