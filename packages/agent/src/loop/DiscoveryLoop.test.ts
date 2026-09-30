import type { InterventionId, RunLogEntryInput } from '@idp/artifact-schema';
import { FakeClock } from '@idp/evidence/testing';
import { createRedactor, resolvePolicy } from '@idp/policy';
import type { ApprovalOutcome, EscalationOutcome, SessionHumanAction } from '@idp/session';
import {
	ApprovalRequiredError,
	fingerprintKey,
	PolicyDeniedError,
	type A11yNode,
	type ApprovalGrant,
	type Observation,
} from '@idp/surface';
import { FakeSurface, fakeFingerprint, fakeLocation, mockBankPolicyConfig } from '@idp/surface/testing';
import { describe, expect, it, vi } from 'vitest';
import { ModelCallError } from '../errors/ModelCallError.js';
import type { ModelCallOptions, ModelClient, ModelRequest } from '../model/ModelClient.js';
import type { ModelTurn } from '../model/ModelTurn.js';
import { ScriptedModel } from '../model/ScriptedModel.js';
import type { ModelScriptInput } from '../model/ModelScript.js';
import { DiscoveryLoop } from './DiscoveryLoop.js';
import type { DiscoverySession } from './DiscoverySession.js';

const ORIGIN = 'http://bank.test';
const RUN_ID = 'discovery-20260929T101500-a1b2';
const REQUEST_ID = 'ir-20260929T101500-beef' as InterventionId;
const policy = resolvePolicy(mockBankPolicyConfig(ORIGIN));
const confirm = fakeFingerprint({ name: 'Confirm', visibleText: 'Confirm' });
const memberInput = fakeFingerprint({
	role: 'textbox',
	name: '',
	tag: 'input',
	inputType: 'text',
	labelCellText: 'Member #',
	container: { element: 'input', index: 0, containerText: 'Member Search' },
	visibleText: '',
});
const grant: ApprovalGrant = {
	requestId: REQUEST_ID,
	fingerprintKey: fingerprintKey(confirm),
	issuedAt: '2026-09-29T10:15:00.000Z',
	expiresAt: '2026-09-29T10:20:00.000Z',
	grantedBy: 'operator:ops-1',
};

/** A screen with one button `e1` in the content frame; `title` makes each screen's digest distinct. */
function screen(title: string, text = title): Observation {
	const button: A11yNode = { ref: 'e1', role: 'button', name: 'Confirm', framePath: ['content'], children: [] };
	return {
		url: `${ORIGIN}/`,
		title: 'CoreOne 7.4',
		frames: [
			{ path: [], name: '', url: `${ORIGIN}/`, title: 'CoreOne 7.4', status: 200, text: '', textTruncated: false },
			{
				path: ['content'],
				name: 'content',
				url: `${ORIGIN}/${title.toLowerCase().replace(/\s+/g, '-')}`,
				title: `CoreOne - ${title}`,
				status: 200,
				text,
				textTruncated: false,
			},
		],
		tree: {
			role: 'document',
			name: '',
			framePath: [],
			children: [
				{
					role: 'iframe',
					name: '',
					framePath: [],
					children: [{ role: 'document', name: '', framePath: ['content'], children: [button] }],
				},
			],
		},
		pendingDialog: null,
		lastNavigation: null,
		digest: title,
	};
}

const click = { tool: 'click', target: { ref: 'e1' }, input: { reason: 'Confirm the request.' } };
const finish = {
	tool: 'finish',
	input: {
		summary: 'Done for {{memberId}}.',
		finalCheckpoint: { kind: 'text', text: 'Opened', frame: 'content' },
		reason: 'The confirmation is shown.',
	},
};
const help = { tool: 'request_help', input: { reason: 'I do not know the member number field.' } };

interface Harness {
	readonly session: DiscoverySession;
	readonly surface: FakeSurface;
	readonly logs: RunLogEntryInput[];
	readonly prompts: { name: string; document: unknown; subdir: string | undefined }[];
	readonly reacquire: ReturnType<typeof vi.fn>;
}

function harness(options: {
	readonly observations: readonly Observation[];
	readonly approval?: ApprovalOutcome;
	readonly escalation?: EscalationOutcome;
	readonly requireApproval?: boolean;
	/** Every click is denied by policy (pre-action). */
	readonly denyClicks?: boolean;
	/** `null` = unattended. */
	readonly controlUrl?: string | null;
}): Harness {
	const logs: RunLogEntryInput[] = [];
	const prompts: Harness['prompts'] = [];
	const surface = new FakeSurface({
		location: fakeLocation(ORIGIN, '/'),
		observations: options.observations,
		fingerprint: (target) => (target.kind === 'ref' && target.ref === 'e1' ? confirm : memberInput),
		onAct: (action) => {
			if (options.denyClicks === true && action.kind === 'click') {
				throw new PolicyDeniedError('click', 'action_not_allowed', 'not allowed', 'pre_action');
			}
			if (options.requireApproval === true && action.kind === 'click' && action.approvalGrant === undefined) {
				throw new ApprovalRequiredError({ actionKind: 'click', reason: 'control name', fingerprint: confirm });
			}
			return undefined;
		},
	});
	const reacquire = vi.fn(async () => 'AGENT' as const);
	const session: DiscoverySession = {
		surface,
		runId: RUN_ID,
		controlUrl: options.controlUrl === undefined ? 'http://127.0.0.1:1' : options.controlUrl,
		evidence: {
			putJson: vi.fn(async (name: string, document: unknown, subdir?: 'prompts' | 'interventions') => {
				prompts.push({ name, document, subdir });
				return {
					id: name,
					kind: 'json' as const,
					path: `${subdir ?? ''}/${name}.json`,
					sha256: '0'.repeat(64),
					localOnly: false,
				};
			}),
		} as unknown as DiscoverySession['evidence'],
		runLog: {
			log: (entry: RunLogEntryInput) => (logs.push(entry), { ...entry, seq: logs.length }),
		} as DiscoverySession['runLog'],
		lease: { reacquire } as unknown as DiscoverySession['lease'],
		requestApproval: vi.fn(
			async (): Promise<ApprovalOutcome> => options.approval ?? { kind: 'unattended', requestId: REQUEST_ID },
		),
		escalate: vi.fn(
			async (): Promise<EscalationOutcome> => options.escalation ?? { kind: 'unattended', requestId: REQUEST_ID },
		),
	};
	return { session, surface, logs, prompts, reacquire };
}

function run(
	h: Harness,
	steps: ModelScriptInput['steps'] | ModelClient,
	options: { readonly timeoutMs?: number; readonly clock?: FakeClock } = {},
) {
	const redactor = createRedactor({
		config: policy,
		sensitiveValues: [{ value: '12345', paramName: 'memberId' }, 'teller01', 'synthetic-pass-01'],
	});
	return DiscoveryLoop.run({
		goal: 'Open a sub-account for member 12345',
		exampleInputs: { memberId: '12345' },
		credentials: { username: 'teller01', password: 'synthetic-pass-01' },
		session: h.session,
		model: Array.isArray(steps) ? new ScriptedModel({ scriptVersion: 1, name: 'unit', steps }) : steps,
		redactor,
		policy,
		options: {
			clock: options.clock ?? new FakeClock(),
			...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
		},
	});
}

/** A fake model client whose call fails, or never settles unless aborted, or answers after a fake delay. */
class FakeModel implements ModelClient {
	readonly modelId = 'fake:unit';
	readonly calls: (ModelCallOptions | undefined)[] = [];
	constructor(private readonly behave: (options: ModelCallOptions | undefined) => Promise<ModelTurn>) {}
	next(_request: ModelRequest, options?: ModelCallOptions): Promise<ModelTurn> {
		this.calls.push(options);
		return this.behave(options);
	}
}

describe('DiscoveryLoop', () => {
	it('an irreversible action asks for approval bound to the target, then acts once with the grant', async () => {
		const h = harness({
			observations: [screen('Review'), screen('Opened')],
			requireApproval: true,
			approval: { kind: 'granted', requestId: REQUEST_ID, grant },
		});
		const outcome = await run(h, [click, finish]);
		expect(outcome.kind).toBe('goal_met');
		expect(h.session.requestApproval).toHaveBeenCalledWith(
			expect.objectContaining({ index: 0, fingerprintKey: fingerprintKey(confirm) }),
		);
		expect(h.surface.acts.map((action) => action.approvalGrant)).toEqual([undefined, grant]);
		expect(outcome.trace.steps).toEqual([
			expect.objectContaining({ actor: 'agent', action: { kind: 'click' }, verdict: 'ok', approved: true }),
		]);
		expect(outcome.kind === 'goal_met' && outcome.finalCheckpoint).toEqual({
			kind: 'text_present',
			text: 'Opened',
			frame: [{ kind: 'by_name', name: 'content' }],
		});
	});

	it('a rejected approval stops with human_aborted; an unattended one with policy_blocked', async () => {
		const rejected = await run(
			harness({
				observations: [screen('Review')],
				requireApproval: true,
				approval: { kind: 'rejected', requestId: REQUEST_ID },
			}),
			[click],
		);
		expect(rejected).toMatchObject({ kind: 'stopped', reason: 'human_aborted', interventionRequestId: REQUEST_ID });
		const unattended = await run(harness({ observations: [screen('Review')], requireApproval: true }), [click]);
		expect(unattended).toMatchObject({ kind: 'stopped', reason: 'policy_blocked', interventionRequestId: REQUEST_ID });
		expect(unattended.trace.steps).toEqual([
			expect.objectContaining({ verdict: 'refused', errorCode: 'APPROVAL_REQUIRED' }),
		]);
	});

	it('request_help attended: the operator acts, the actions join the trace as human steps, the lease is reacquired', async () => {
		const humanActions: SessionHumanAction[] = [
			{
				seq: 1,
				kind: 'fill',
				fingerprint: memberInput,
				value: '12345',
				sensitive: true,
				verdict: 'allow',
				refused: false,
				at: '2026-09-29T10:15:01.000Z',
				operator: 'operator:ops-1',
			},
			{
				seq: 2,
				kind: 'click',
				fingerprint: confirm,
				sensitive: false,
				verdict: 'allow',
				refused: false,
				at: '2026-09-29T10:15:02.000Z',
				operator: 'operator:ops-1',
			},
		];
		const h = harness({
			observations: [screen('Member Search'), screen('Opened')],
			escalation: { kind: 'resumed', requestId: REQUEST_ID, humanActions },
		});
		const outcome = await run(h, [help, finish]);
		expect(outcome.kind).toBe('goal_met');
		expect(h.reacquire).toHaveBeenCalledOnce();
		const [fill, human] = outcome.trace.steps;
		expect(fill).toMatchObject({
			actor: 'human',
			operator: 'operator:ops-1',
			action: { kind: 'fill', value: { kind: 'param', name: 'memberId' }, sensitive: true },
			verdict: 'ok',
			diff: null,
		});
		expect(human).toMatchObject({ actor: 'human', action: { kind: 'click' }, verdict: 'ok' });
		expect(human?.diff?.titleChanges[0]?.visibleSegments).toEqual(['Opened']);
		expect(JSON.stringify(outcome.trace)).not.toContain('12345');
	});

	it.each(['24680', '900-12-3456'])(
		'request_help: a sensitive human fill of %s that is no param keeps its sensitivity and never its value',
		async (value) => {
			const humanActions: SessionHumanAction[] = [
				{
					seq: 1,
					kind: 'fill',
					fingerprint: memberInput,
					value,
					sensitive: true,
					verdict: 'allow',
					refused: false,
					at: '2026-09-29T10:15:01.000Z',
					operator: 'operator:ops-1',
				},
				{
					seq: 2,
					kind: 'click',
					fingerprint: confirm,
					sensitive: false,
					verdict: 'allow',
					refused: false,
					at: '2026-09-29T10:15:02.000Z',
					operator: 'operator:ops-1',
				},
			];
			const h = harness({
				observations: [screen('Member Search'), screen('Opened')],
				escalation: { kind: 'resumed', requestId: REQUEST_ID, humanActions },
			});
			const outcome = await run(h, [help, finish]);
			expect(outcome.kind).toBe('goal_met');
			const [fill] = outcome.trace.steps;
			expect(fill).toMatchObject({
				actor: 'human',
				action: { kind: 'fill', value: { kind: 'literal', value: '[REDACTED]' }, sensitive: true },
				verdict: 'ok',
			});
			expect(JSON.stringify(outcome.trace)).not.toContain(value);
		},
	);

	it('request_help: an operator abort stops with human_aborted', async () => {
		const h = harness({
			observations: [screen('Member Search')],
			escalation: { kind: 'aborted', requestId: REQUEST_ID, humanActions: [] },
		});
		expect(await run(h, [help])).toMatchObject({ kind: 'stopped', reason: 'human_aborted' });
	});

	it('refuses to extract into an undeclared output without acting', async () => {
		const h = harness({ observations: [screen('Member Search'), screen('Member Search 2')] });
		const outcome = await run(h, [
			{ tool: 'extract', target: { ref: 'e1' }, input: { output: 'balance', reason: 'Read it.' } },
			{ tool: 'request_help', input: { reason: 'stuck' } },
		]);
		expect(h.surface.acts).toEqual([]);
		expect(outcome).toMatchObject({ kind: 'stopped', reason: 'model_gave_up' });
	});

	it('writes one redacted prompt per turn and logs each decision with its reason', async () => {
		const h = harness({ observations: [screen('Review'), screen('Opened')], approval: undefined });
		await run(h, [click, finish]);
		expect(h.prompts.map((prompt) => [prompt.name, prompt.subdir])).toEqual([
			['turn-01', 'prompts'],
			['turn-02', 'prompts'],
		]);
		const text = JSON.stringify(h.prompts);
		expect(text).not.toContain('12345');
		expect(text).toContain('{{memberId}}');
		const decisions = h.logs.filter((entry) => entry.kind === 'decision');
		expect(decisions.map((entry) => entry.kind === 'decision' && [entry.tool, entry.reason])).toEqual([
			['click', 'Confirm the request.'],
			['finish', 'The confirmation is shown.'],
		]);
		expect(h.logs.some((entry) => entry.kind === 'action' && entry.actionKind === 'click')).toBe(true);
	});

	it('navigates to the target entry route itself before the first observation the model sees', async () => {
		const h = harness({ observations: [screen('Blank'), screen('Sign On'), screen('Opened')] });
		const redactor = createRedactor({ sensitiveValues: [] });
		const outcome = await DiscoveryLoop.run({
			goal: 'Sign on',
			target: '/',
			exampleInputs: {},
			session: h.session,
			model: new ScriptedModel({ scriptVersion: 1, name: 'unit', steps: [finish] }),
			redactor,
			policy,
			options: { clock: new FakeClock() },
		});
		expect(h.surface.acts[0]).toMatchObject({ kind: 'navigate', route: '/', actor: 'agent' });
		expect(outcome.trace.steps[0]).toMatchObject({
			actor: 'agent',
			action: { kind: 'navigate', route: '/' },
			verdict: 'ok',
		});
	});

	describe('repeated policy denials (FR6)', () => {
		it('attended: escalates like a dead end; the operator resumes and the run continues', async () => {
			const h = harness({
				observations: [screen('Review'), screen('Opened')],
				denyClicks: true,
				escalation: { kind: 'resumed', requestId: REQUEST_ID, humanActions: [] },
			});
			const outcome = await run(h, [click, click, click, finish]);
			expect(h.session.escalate).toHaveBeenCalledOnce();
			expect(h.session.escalate).toHaveBeenCalledWith(
				expect.objectContaining({ code: 'policy_blocked' }),
				expect.objectContaining({ risk: 'read' }),
			);
			expect(h.reacquire).toHaveBeenCalledOnce();
			expect(outcome.kind).toBe('goal_met');
		});

		it('unattended: the request is raised and the run stops with policy_blocked', async () => {
			const h = harness({ observations: [screen('Review')], denyClicks: true, controlUrl: null });
			const outcome = await run(h, [click, click, click]);
			expect(outcome).toMatchObject({
				kind: 'stopped',
				reason: 'policy_blocked',
				interventionRequestId: REQUEST_ID,
				detail: expect.stringContaining('3 consecutive policy denials'),
			});
			expect(outcome.trace.steps.map((step) => step.verdict)).toEqual(['refused', 'refused', 'refused']);
		});

		it('an operator abort during a denial escalation stops with human_aborted', async () => {
			const h = harness({
				observations: [screen('Review')],
				denyClicks: true,
				escalation: { kind: 'aborted', requestId: REQUEST_ID, humanActions: [] },
			});
			expect(await run(h, [click, click, click])).toMatchObject({ kind: 'stopped', reason: 'human_aborted' });
		});
	});

	describe('model failures and the time budget (FR9)', () => {
		it('a ModelCallError after the client retries stops with model_error and records retryable', async () => {
			const h = harness({ observations: [screen('Review')] });
			const model = new FakeModel(() =>
				Promise.reject(new ModelCallError('model call failed (HTTP 529): overloaded', 529, true)),
			);
			const outcome = await run(h, model);
			expect(outcome).toMatchObject({
				kind: 'stopped',
				reason: 'model_error',
				retryable: true,
				turns: 1,
				detail: expect.stringContaining('retryable: true'),
			});
			// The prompt of the failed turn is still written.
			expect(h.prompts.map((prompt) => prompt.name)).toEqual(['turn-01']);
		});

		it('any other error from the model client still propagates', async () => {
			const h = harness({ observations: [screen('Review')] });
			const model = new FakeModel(() => Promise.reject(new TypeError('a bug')));
			await expect(run(h, model)).rejects.toBeInstanceOf(TypeError);
		});

		it('passes the remaining budget to the call and stops with timeout when a call hangs past it', async () => {
			const h = harness({ observations: [screen('Review')] });
			// Never settles on its own: only the loop's own deadline ends the wait (even if a client ignores the signal).
			const model = new FakeModel(() => new Promise<ModelTurn>(() => undefined));
			const started = Date.now();
			const outcome = await run(h, model, { timeoutMs: 1_000, clock: new FakeClock() });
			expect(Date.now() - started).toBeLessThan(5_000);
			expect(outcome).toMatchObject({ kind: 'stopped', reason: 'timeout' });
			expect(outcome.kind === 'stopped' && outcome.detail).toContain('a model call was cut off');
			expect(model.calls[0]?.timeoutMs).toBe(1_000);
			expect(model.calls[0]?.signal?.aborted).toBe(true);
		});

		it('a client that honours the abort signal and rejects is reported as timeout, not model_error', async () => {
			const h = harness({ observations: [screen('Review')] });
			const model = new FakeModel(
				(options) =>
					new Promise<ModelTurn>((_resolve, reject) => {
						options?.signal?.addEventListener('abort', () =>
							reject(new ModelCallError('model call failed (APIUserAbortError): aborted', undefined, true)),
						);
					}),
			);
			const outcome = await run(h, model, { timeoutMs: 50 });
			expect(outcome).toMatchObject({ kind: 'stopped', reason: 'timeout' });
		});
	});

	it('logs the model response metadata with each decision (FR10)', async () => {
		const h = harness({ observations: [screen('Review'), screen('Opened')] });
		await run(h, [click, finish]);
		const decisions = h.logs.filter((entry) => entry.kind === 'decision');
		expect(decisions.map((entry) => entry.kind === 'decision' && entry.modelResponse)).toEqual([
			{
				responseId: 'scripted-1',
				model: 'scripted:unit',
				stopReason: 'tool_use',
				usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
				latencyMs: 0,
			},
			expect.objectContaining({ responseId: 'scripted-2' }),
		]);
	});

	it('logs provider metadata and latency from a real-shaped turn', async () => {
		const clock = new FakeClock();
		const h = harness({ observations: [screen('Review'), screen('Opened')] });
		const turns: ModelTurn[] = [
			{
				toolCalls: [{ id: 'toolu_1', name: 'request_help', input: { reason: 'The screen shows nothing I can use.' } }],
				text: '',
				stopReason: 'tool_use',
				usage: { inputTokens: 12345, outputTokens: 210, cacheReadInputTokens: 11000, cacheCreationInputTokens: 45 },
				response: { id: 'msg_01XFDUDYJgAACzvnptvVoYEL', model: 'claude-sonnet-5-5-20260901', stopReason: 'tool_use' },
			},
		];
		const model = new FakeModel(async () => {
			clock.advance(2_345);
			const turn = turns.shift();
			if (turn === undefined) throw new ModelCallError('no more turns', undefined, false);
			return turn;
		});
		await run(h, model, { clock });
		const [decision] = h.logs.filter((entry) => entry.kind === 'decision');
		expect(decision).toMatchObject({
			modelResponse: {
				responseId: 'msg_01XFDUDYJgAACzvnptvVoYEL',
				model: 'claude-sonnet-5-5-20260901',
				stopReason: 'tool_use',
				usage: { inputTokens: 12345, outputTokens: 210, cacheReadInputTokens: 11000, cacheCreationInputTokens: 45 },
				latencyMs: 2_345,
			},
		});
	});
});
