import { describe, expect, it } from 'vitest';
import { ToolCallError } from '../errors/ToolCallError.js';
import { toolToAction, type ToolCallContext } from './toolToAction.js';

const context: ToolCallContext = {
	params: { memberId: '12345', product: 'Holiday Club' },
	sensitiveParams: new Set(['memberId']),
	credentials: { username: 'teller01', password: 'synthetic-pass-01' },
};

const call = (name: string, input: Record<string, unknown>) => ({ id: 'toolu_1', name, input });

function toolError(fn: () => unknown): ToolCallError {
	try {
		fn();
	} catch (error) {
		if (error instanceof ToolCallError) return error;
		throw error;
	}
	throw new Error('expected a ToolCallError');
}

describe('toolToAction', () => {
	it('maps click to a ref-targeted agent action with the reason', () => {
		expect(toolToAction(call('click', { ref: 'e7', reason: 'submit the search' }), context)).toEqual({
			kind: 'action',
			reason: 'submit the search',
			action: {
				kind: 'click',
				actor: 'agent',
				target: { kind: 'ref', ref: 'e7' },
				bindings: { memberId: '12345', product: 'Holiday Club' },
			},
		});
	});

	it('resolves a {{param}} fill to the concrete value, sensitive, and records the param source', () => {
		const decision = toolToAction(call('fill', { ref: 'e3', value: '{{memberId}}', reason: 'r' }), context);
		expect(decision).toMatchObject({
			kind: 'action',
			valueSource: { kind: 'param', name: 'memberId' },
			action: { kind: 'fill', value: '12345', sensitive: true, target: { kind: 'ref', ref: 'e3' } },
		});
	});

	it('resolves credential placeholders without the model ever seeing the secret', () => {
		const user = toolToAction(call('fill', { ref: 'e1', value: '{{credential.username}}', reason: 'r' }), context);
		const password = toolToAction(call('fill', { ref: 'e2', value: '{{credential.password}}', reason: 'r' }), context);
		expect(user).toMatchObject({
			valueSource: { kind: 'credential', field: 'username' },
			action: { value: 'teller01', sensitive: true },
		});
		expect(password).toMatchObject({
			valueSource: { kind: 'credential', field: 'password' },
			action: { value: 'synthetic-pass-01', sensitive: true },
		});
	});

	it('keeps a non-sensitive literal as typed and a non-sensitive param as not sensitive', () => {
		expect(toolToAction(call('fill', { ref: 'e4', value: 'Summer fund', reason: 'r' }), context)).toMatchObject({
			valueSource: { kind: 'literal' },
			action: { value: 'Summer fund', sensitive: false },
		});
		expect(toolToAction(call('select', { ref: 'e5', option: '{{product}}', reason: 'r' }), context)).toMatchObject({
			valueSource: { kind: 'param', name: 'product' },
			action: { kind: 'select', option: 'Holiday Club' },
		});
	});

	it('refuses an unknown placeholder, a missing credential, and a literal carrying a known value', () => {
		expect(
			toolError(() => toolToAction(call('fill', { ref: 'e1', value: '{{ssn}}', reason: 'r' }), context)).code,
		).toBe('UNKNOWN_PLACEHOLDER');
		expect(
			toolError(() =>
				toolToAction(call('fill', { ref: 'e1', value: '{{credential.password}}', reason: 'r' }), { params: {} }),
			).code,
		).toBe('UNKNOWN_PLACEHOLDER');
		const leak = toolError(() => toolToAction(call('fill', { ref: 'e1', value: 'id 12345', reason: 'r' }), context));
		expect(leak.code).toBe('SENSITIVE_LITERAL');
		expect(leak.message).not.toContain('12345');
	});

	it('maps navigate, press, extract and dismiss_dialog', () => {
		expect(toolToAction(call('navigate', { route: '/member/search', reason: 'r' }), context)).toMatchObject({
			action: { kind: 'navigate', route: '/member/search', actor: 'agent' },
		});
		expect(toolToAction(call('press', { key: 'Enter', reason: 'r' }), context)).toMatchObject({
			action: { kind: 'press', key: 'Enter' },
		});
		expect(toolToAction(call('press', { key: 'Tab', ref: 'e2', reason: 'r' }), context)).toMatchObject({
			action: { kind: 'press', key: 'Tab', target: { kind: 'ref', ref: 'e2' } },
		});
		expect(toolToAction(call('extract', { ref: 'e9', output: 'savingsBalance', reason: 'r' }), context)).toMatchObject({
			output: 'savingsBalance',
			action: { kind: 'extract', target: { kind: 'ref', ref: 'e9' } },
		});
		expect(
			toolToAction(call('dismiss_dialog', { match: 'cannot be undone', action: 'accept', reason: 'r' }), context),
		).toMatchObject({ action: { kind: 'dismiss_dialog', match: 'cannot be undone', action: 'accept' } });
	});

	it('maps wait to a checkpoint with a named frame and a bounded timeout', () => {
		expect(
			toolToAction(
				call('wait', { condition: 'text_present', text: 'Member Inquiry', frame: 'content', reason: 'r' }),
				context,
			),
		).toMatchObject({
			action: {
				kind: 'wait',
				timeoutMs: 10_000,
				until: { kind: 'text_present', text: 'Member Inquiry', frame: [{ kind: 'by_name', name: 'content' }] },
			},
		});
		expect(
			toolToAction(
				call('wait', { condition: 'title_contains', text: 'Inquiry', timeoutMs: 2000, reason: 'r' }),
				context,
			),
		).toMatchObject({
			action: { timeoutMs: 2000, until: { kind: 'title_matches', title: 'Inquiry', match: 'contains' } },
		});
		expect(
			toolError(() =>
				toolToAction(call('wait', { condition: 'text_present', text: 'hi {{pin}}', reason: 'r' }), context),
			).code,
		).toBe('UNKNOWN_PLACEHOLDER');
	});

	it('maps the control tools to control signals', () => {
		expect(
			toolToAction(
				call('declare_output', {
					name: 'savingsBalance',
					type: 'decimal',
					description: 'Share Savings balance',
					sensitive: true,
					reason: 'r',
				}),
				context,
			),
		).toEqual({
			kind: 'declare_output',
			reason: 'r',
			output: {
				name: 'savingsBalance',
				description: 'Share Savings balance',
				type: { kind: 'decimal', scale: 2 },
				sensitive: true,
			},
		});
		expect(
			toolToAction(
				call('finish', {
					summary: 'done',
					finalCheckpoint: { kind: 'text', text: 'Member Inquiry', frame: 'content' },
					reason: 'r',
				}),
				context,
			),
		).toEqual({
			kind: 'finish',
			reason: 'r',
			summary: 'done',
			finalCheckpoint: { kind: 'text', text: 'Member Inquiry', frame: ['content'] },
		});
		expect(
			toolToAction(
				call('finish', { summary: 'd', finalCheckpoint: { kind: 'element', ref: 'e4' }, reason: 'r' }),
				context,
			),
		).toMatchObject({ finalCheckpoint: { kind: 'element', ref: 'e4' } });
		expect(toolToAction(call('request_help', { reason: 'stuck on a captcha' }), context)).toEqual({
			kind: 'request_help',
			reason: 'stuck on a captcha',
		});
	});

	it('rejects an unknown tool and invalid input as typed tool errors', () => {
		expect(toolError(() => toolToAction(call('rm_rf', { reason: 'r' }), context))).toMatchObject({
			code: 'UNKNOWN_TOOL',
			toolName: 'rm_rf',
		});
		expect(toolError(() => toolToAction(call('click', { ref: 'e1' }), context)).code).toBe('INVALID_INPUT');
		expect(toolError(() => toolToAction(call('click', { ref: 'button 3', reason: 'r' }), context)).code).toBe(
			'INVALID_INPUT',
		);
		expect(toolError(() => toolToAction(call('click', { ref: 'e1', reason: 'r', force: true }), context)).code).toBe(
			'INVALID_INPUT',
		);
		expect(
			toolError(() =>
				toolToAction(call('finish', { summary: 's', finalCheckpoint: { kind: 'text' }, reason: 'r' }), context),
			).code,
		).toBe('INVALID_INPUT');
		expect(toolError(() => toolToAction({ id: 'x', name: 'click', input: 'e1' }, context)).code).toBe('INVALID_INPUT');
	});

	it('never echoes a sensitive input value in an error message', () => {
		const error = toolError(() => toolToAction(call('fill', { ref: 'e1', value: 12345, reason: 'r' }), context));
		expect(error.code).toBe('INVALID_INPUT');
		expect(error.message).not.toContain('12345');
	});
});
