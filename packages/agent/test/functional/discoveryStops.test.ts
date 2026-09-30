import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RunManifestSchema, RunResultSchema } from '@idp/artifact-schema';
import { FakeClock } from '@idp/evidence/testing';
import { launchMockBank, type MockBank } from '@idp/surface/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	DiscoveryRunner,
	ScriptedModel,
	STOP_FAILURE_REASONS,
	type DiscoveryRunnerOptions,
	type DiscoveryRunResult,
	type ModelClient,
	type ModelRequest,
	type ModelScriptInput,
	type ModelTurn,
	type StopReason,
} from '../../src/index.js';
import {
	CONCRETE_VALUES,
	CREDENTIALS,
	MEMBER_ID,
	MEMBER_ID_PARAM,
	MEMBER_LOOKUP_GOAL,
	mockBankPolicy,
	mockBankProfile,
	runFiles,
} from './discoveryHarness.js';

const userId = { role: 'textbox', label: 'User ID', frame: 'content' };
const fillUserId = (value: string) => ({ tool: 'fill', target: userId, input: { value, reason: `Try ${value}.` } });
const waitForSignOn = {
	tool: 'wait',
	input: { condition: 'text_present', text: 'Sign On', frame: 'content', reason: 'Wait for the Sign On form.' },
};
const finishOnInquiry = {
	tool: 'finish',
	input: {
		summary: 'Found the member.',
		finalCheckpoint: { kind: 'text', text: 'Member Inquiry', frame: 'content' },
		reason: 'I believe Member Inquiry is shown.',
	},
};

function script(name: string, steps: ModelScriptInput['steps'], extra: Partial<ModelScriptInput> = {}): ScriptedModel {
	return new ScriptedModel({ scriptVersion: 1, name, steps, ...extra });
}

/** A model that advances a fake clock on every turn (the timeout case). */
class ClockedModel implements ModelClient {
	readonly modelId: string;
	constructor(
		private readonly inner: ModelClient,
		private readonly clock: FakeClock,
		private readonly msPerTurn: number,
	) {
		this.modelId = inner.modelId;
	}
	next(request: ModelRequest): Promise<ModelTurn> {
		this.clock.advance(this.msPerTurn);
		return this.inner.next(request);
	}
}

describe('agent: every discovery stop condition stops without compiling an artifact (AC2)', () => {
	let bank: MockBank;
	let root: string;

	beforeAll(async () => {
		bank = await launchMockBank({ tenant: 'a' });
		root = await mkdtemp(path.join(tmpdir(), 'idp-stops-'));
	});
	afterAll(async () => {
		await bank?.stop();
		if (root !== undefined) await rm(root, { recursive: true, force: true });
	});

	async function discover(
		model: ModelClient,
		extra: Partial<DiscoveryRunnerOptions> = {},
	): Promise<DiscoveryRunResult> {
		await bank.reset();
		return new DiscoveryRunner({
			goal: MEMBER_LOOKUP_GOAL,
			params: [MEMBER_ID_PARAM],
			exampleInputs: { memberId: MEMBER_ID },
			credentials: CREDENTIALS,
			profile: await mockBankProfile(bank.origin),
			policy: mockBankPolicy(bank.origin),
			model,
			runsRoot: root,
			...extra,
		}).run();
	}

	/** The run stopped for `reason`: a failure result, no artifact.json, a closed manifest, no concrete value. */
	async function expectStopped(run: DiscoveryRunResult, reason: StopReason): Promise<void> {
		expect(run.outcome).toMatchObject({ kind: 'stopped', reason });
		expect(run.artifact).toBeUndefined();
		expect(run.artifactPath).toBeUndefined();
		await expect(access(path.join(run.runDir, 'artifact.json'))).rejects.toThrow();
		const result = RunResultSchema.parse(JSON.parse(await readFile(path.join(run.runDir, 'result.json'), 'utf8')));
		expect(result).toMatchObject({ kind: 'failure', artifact: null, reason: STOP_FAILURE_REASONS[reason] });
		expect(result.kind === 'failure' && result.observed).toContain(`discovery stopped (${reason})`);
		const manifest = RunManifestSchema.parse(
			JSON.parse(await readFile(path.join(run.runDir, 'manifest.json'), 'utf8')),
		);
		expect(manifest).toMatchObject({ kind: 'discovery', resultKind: 'failure', artifact: null });
		for (const [name, text] of await runFiles(run.runDir)) {
			for (const value of CONCRETE_VALUES) expect(text, `${name} holds a concrete value`).not.toContain(value);
		}
	}

	it('max_steps: a looping script uses up a small step budget', async () => {
		const model = script('loop', [fillUserId('a'), fillUserId('b'), fillUserId('c')], { onExhausted: 'loop' });
		const run = await discover(model, { loop: { maxSteps: 4 } });
		await expectStopped(run, 'max_steps');
		expect(run.outcome.turns).toBe(4);
		expect(model.requests).toHaveLength(4);
	});

	it('timeout: the time budget runs out on the injected clock', async () => {
		const clock = new FakeClock();
		const inner = script('loop', [fillUserId('a'), fillUserId('b'), fillUserId('c')], { onExhausted: 'loop' });
		const run = await discover(new ClockedModel(inner, clock, 60_000), { loop: { clock, timeoutMs: 150_000 } });
		await expectStopped(run, 'timeout');
		expect(run.outcome.turns).toBe(3);
	});

	it('dead_end: no progress on the same screen raises an intervention request and stops', async () => {
		const run = await discover(script('stuck', [{ ...waitForSignOn, repeat: 10 }]));
		await expectStopped(run, 'dead_end');
		expect(run.outcome.turns).toBe(2);
		const requestId = run.outcome.kind === 'stopped' ? run.outcome.interventionRequestId : undefined;
		expect(requestId).toMatch(/^ir-/);
		const files = await runFiles(run.runDir);
		expect([...files.keys()]).toContain(path.join('interventions', `${requestId ?? ''}.json`));
	});

	it('policy_blocked: three consecutive denials (navigating to /__admin/faults) stop the run', async () => {
		const model = script('admin', [
			{ tool: 'navigate', input: { route: '/__admin/faults', reason: 'Open the admin page.' }, repeat: 3 },
			waitForSignOn,
		]);
		const run = await discover(model);
		await expectStopped(run, 'policy_blocked');
		expect(run.outcome.turns).toBe(3);
		const denials = run.outcome.trace.steps.filter((step) => step.verdict === 'refused');
		expect(denials).toHaveLength(3);
		// Each denial went back to the model as an error tool result.
		const last = model.requests.at(-1)?.messages.at(-1);
		expect(last?.role === 'user' && last.content[0]?.kind === 'tool_result' && last.content[0].isError).toBe(true);
	});

	it('goal_unverified: two finishes whose checkpoint text is absent', async () => {
		const run = await discover(script('premature', [finishOnInquiry, finishOnInquiry]));
		await expectStopped(run, 'goal_unverified');
		expect(run.outcome.turns).toBe(2);
		expect(run.outcome.trace.finish).toBeNull();
	});

	it('model_gave_up: the model ends its turn without a tool call', async () => {
		const run = await discover(script('quits', [waitForSignOn], { onExhausted: 'end_turn' }));
		await expectStopped(run, 'model_gave_up');
		expect(run.outcome.turns).toBe(2);
	});

	it('model_gave_up: request_help with nobody attending raises a request and stops', async () => {
		const run = await discover(
			script('asks', [{ tool: 'request_help', input: { reason: 'I cannot find the member search.' } }]),
		);
		await expectStopped(run, 'model_gave_up');
		expect(run.outcome.kind === 'stopped' ? run.outcome.interventionRequestId : undefined).toMatch(/^ir-/);
	});
});
