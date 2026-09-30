import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	CapabilityArtifactSchema,
	computeContentHash,
	RunLogEntrySchema,
	RunManifestSchema,
	RunResultSchema,
	SCREEN_CHANGING_KINDS,
} from '@idp/artifact-schema';
import { launchMockBank, type MockBank } from '@idp/surface/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DiscoveryRunner, ScriptedModel, type DiscoveryRunResult } from '../../src/index.js';
import {
	CONCRETE_VALUES,
	CREDENTIALS,
	MEMBER_ID,
	MEMBER_ID_PARAM,
	MEMBER_LOOKUP_GOAL,
	mockBankPolicy,
	mockBankProfile,
	runFiles,
	scriptPath,
} from './discoveryHarness.js';

describe('agent: scripted discovery of member-lookup compiles an artifact (AC1 shape, no LLM)', () => {
	let bank: MockBank;
	let root: string;
	let run: DiscoveryRunResult;
	let model: ScriptedModel;

	beforeAll(async () => {
		bank = await launchMockBank({ tenant: 'a' });
		root = await mkdtemp(path.join(tmpdir(), 'idp-discover-'));
		model = await ScriptedModel.fromFile(scriptPath('member-lookup.script.json'));
		run = await new DiscoveryRunner({
			goal: MEMBER_LOOKUP_GOAL,
			params: [MEMBER_ID_PARAM],
			exampleInputs: { memberId: MEMBER_ID },
			credentials: CREDENTIALS,
			profile: await mockBankProfile(bank.origin),
			policy: mockBankPolicy(bank.origin),
			model,
			runsRoot: root,
			id: 'member-lookup',
			title: 'Member lookup: savings balance and name',
		}).run();
	});
	afterAll(async () => {
		await bank?.stop();
		if (root !== undefined) await rm(root, { recursive: true, force: true });
	});

	it('meets the goal and writes a schema-valid artifact.json whose hash verifies', async () => {
		expect(run.outcome.kind).toBe('goal_met');
		expect(run.artifactPath).toBe(path.join(run.runDir, 'artifact.json'));
		const raw: unknown = JSON.parse(await readFile(run.artifactPath ?? '', 'utf8'));
		const artifact = CapabilityArtifactSchema.parse(raw);
		expect(artifact).toEqual(raw);
		expect(artifact).toEqual(run.artifact);
		expect(artifact.contentHash).toBe(await computeContentHash(artifact));
		expect(artifact.provenance).toMatchObject({ discoveryRunId: run.runId, model: 'scripted:member-lookup' });
	});

	it('has the golden member-lookup shape: sign-on by credential ref, {{memberId}} by param, two extracts', () => {
		const artifact = run.artifact;
		if (artifact === undefined) throw new Error('no artifact');
		expect(artifact.steps.map((step) => [step.kind, step.phase])).toEqual([
			['navigate', 'login'],
			['fill', 'login'],
			['fill', 'login'],
			['click', 'login'],
			['fill', 'main'],
			['click', 'main'],
			['extract', 'main'],
			['extract', 'main'],
		]);
		const fills = artifact.steps.flatMap((step) => (step.kind === 'fill' ? [step.value] : []));
		expect(fills).toEqual([
			{ kind: 'credential', ref: 'mockbank-operator', field: 'username' },
			{ kind: 'credential', ref: 'mockbank-operator', field: 'password' },
			{ kind: 'param', name: 'memberId' },
		]);
		const changing = new Set<string>(SCREEN_CHANGING_KINDS);
		for (const step of artifact.steps) if (changing.has(step.kind)) expect(step.checkpoint).toBeDefined();
		expect(artifact.successCondition).toMatchObject({ kind: 'text_present', text: 'Member Inquiry' });
		expect(JSON.stringify(artifact)).toContain('memberId');
		expect(artifact.outputs.map((output) => output.name)).toEqual(['savingsBalance', 'memberName']);
	});

	it('the artifact never contains a concrete value', async () => {
		const text = await readFile(run.artifactPath ?? '', 'utf8');
		for (const value of CONCRETE_VALUES) expect(text).not.toContain(value);
	});

	it('writes the redacted prompts to prompts/turn-NN.json, none holding a concrete value', async () => {
		const files = await runFiles(run.runDir);
		const prompts = [...files.keys()].filter((name) => name.startsWith('prompts/')).sort();
		expect(prompts.length).toBe(model.requests.length);
		expect(prompts[0]).toBe(path.join('prompts', 'turn-01.json'));
		for (const name of prompts) {
			const text = files.get(name) ?? '';
			for (const value of CONCRETE_VALUES) expect(text, `${name} holds a concrete value`).not.toContain(value);
		}
		expect(files.get(path.join('prompts', 'turn-01.json'))).toContain('{{memberId}}');
	});

	it('no file of the run directory holds a credential or a param value; decisions carry the reasons', async () => {
		const files = await runFiles(run.runDir);
		for (const [name, text] of files) {
			for (const value of CONCRETE_VALUES) expect(text, `${name} holds a concrete value`).not.toContain(value);
		}
		const entries = (files.get('run.jsonl') ?? '')
			.split('\n')
			.filter((line) => line !== '')
			.map((line) => RunLogEntrySchema.parse(JSON.parse(line)));
		const decisions = entries.filter((entry) => entry.kind === 'decision');
		expect(decisions).toHaveLength(model.requests.length);
		expect(decisions[0]).toMatchObject({ tool: 'navigate', reason: 'Open the application entry page.' });
		expect(entries.some((entry) => entry.kind === 'run_started')).toBe(true);
		expect(entries.filter((entry) => entry.kind === 'result')).toEqual([
			expect.objectContaining({ resultKind: 'success' }),
		]);
	});

	it('writes a success result with masked outputs and a manifest pointing at the artifact', async () => {
		const result = RunResultSchema.parse(JSON.parse(await readFile(path.join(run.runDir, 'result.json'), 'utf8')));
		expect(result).toMatchObject({
			kind: 'success',
			runId: run.runId,
			outputs: { savingsBalance: '[REDACTED]', memberName: '[REDACTED]' },
		});
		const manifest = RunManifestSchema.parse(
			JSON.parse(await readFile(path.join(run.runDir, 'manifest.json'), 'utf8')),
		);
		expect(manifest).toMatchObject({ kind: 'discovery', resultKind: 'success', artifact: run.artifactRef });
		expect(manifest.endedAt).not.toBeNull();
	});

	it('the model only ever saw placeholders', () => {
		const sent = JSON.stringify(model.requests);
		for (const value of [MEMBER_ID, CREDENTIALS.username, CREDENTIALS.password]) expect(sent).not.toContain(value);
		expect(sent).toContain('{{memberId}}');
	});
});
