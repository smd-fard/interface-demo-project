import { readFile } from 'node:fs/promises';
import {
	AppProfileSchema,
	CapabilityArtifactSchema,
	computeContentHash,
	SCREEN_CHANGING_KINDS,
	type AppProfile,
	type CapabilityArtifact,
	type ParamSpec,
} from '@idp/artifact-schema';
import { FakeClock } from '@idp/evidence/testing';
import { resolvePolicy, type ResolvedPolicy } from '@idp/policy';
import { mockBankPolicyConfig } from '@idp/surface/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { ArtifactCompileError } from '../errors/ArtifactCompileError.js';
import { ConcreteValueLeakError } from '../errors/ConcreteValueLeakError.js';
import { UnparameterizedSensitiveValueError } from '../errors/UnparameterizedSensitiveValueError.js';
import { UncheckpointableStepError } from '../errors/UncheckpointableStepError.js';
import type { DiscoveryTrace, TraceStep } from '../trace/DiscoveryTrace.js';
import { ArtifactCompiler, type CompileOptions } from './ArtifactCompiler.js';
import { assertNoConcreteValues } from './assertNoConcreteValues.js';

const ORIGIN = 'http://127.0.0.1:4010';
const RUN_ID = 'discovery-20260929T101500-a1b2';
const repo = (path: string) => new URL(`../../../../${path}`, import.meta.url);
const readJson = async (url: URL): Promise<unknown> => JSON.parse(await readFile(url, 'utf8'));

let trace: DiscoveryTrace;
let golden: CapabilityArtifact;
let profile: AppProfile;
let policy: ResolvedPolicy;
const params: ParamSpec[] = [
	{
		name: 'memberId',
		description: 'The 5-digit member number to look up.',
		type: { kind: 'string', pattern: '^\\d{5}$' },
		required: true,
		sensitive: true,
	},
];

beforeAll(async () => {
	trace = (await readJson(new URL('./fixtures/member-lookup.trace.json', import.meta.url))) as DiscoveryTrace;
	golden = CapabilityArtifactSchema.parse(
		await readJson(repo('packages/artifact-schema/fixtures/member-lookup.artifact.json')),
	);
	const rawProfile = JSON.stringify(await readJson(repo('config/apps/mock-bank.profile.json'))).replace(
		'${MOCKBANK_ORIGIN}',
		ORIGIN,
	);
	profile = AppProfileSchema.parse(JSON.parse(rawProfile));
	policy = resolvePolicy(mockBankPolicyConfig(ORIGIN));
});

function options(overrides: Partial<CompileOptions> = {}): CompileOptions {
	return {
		goal: 'Look up member {{memberId}} and return the Share Savings balance and the member name',
		params,
		profile,
		policy,
		runId: RUN_ID,
		modelId: 'scripted:member-lookup',
		clock: new FakeClock(new Date('2026-09-29T10:20:00.000Z')),
		id: 'member-lookup',
		title: 'Member lookup: savings balance and name',
		sensitiveValues: ['12345', 'teller01', 'synthetic-pass-01', '1523.47', 'Jane Sample'],
		...overrides,
	};
}

const compile = (source: DiscoveryTrace, overrides: Partial<CompileOptions> = {}) =>
	new ArtifactCompiler().compile(source, options(overrides));

function withSteps(steps: TraceStep[]): DiscoveryTrace {
	return { ...trace, steps: steps.map((step, index) => ({ ...step, index })) };
}

describe('ArtifactCompiler', () => {
	it('compiles the recorded member-lookup trace into a valid artifact (parse(raw) equals raw)', async () => {
		const artifact = await compile(trace);
		expect(CapabilityArtifactSchema.parse(artifact)).toEqual(artifact);
		expect(artifact.contentHash).toBe(await computeContentHash(artifact));
	});

	it('matches the golden member-lookup shape: kinds, phases, value refs, checkpoints, success condition', async () => {
		const artifact = await compile(trace);
		const shape = (source: CapabilityArtifact) =>
			source.steps.map((step) => ({
				kind: step.kind,
				phase: step.phase,
				checkpoint: step.checkpoint,
				...(step.kind === 'fill' ? { value: step.value, sensitive: step.sensitive } : {}),
				...(step.kind === 'extract' ? { output: step.output, parse: step.parse } : {}),
			}));
		expect(shape(artifact)).toEqual(shape(golden));
		expect(artifact.successCondition).toEqual(golden.successCondition);
		expect(artifact.credentialRef).toBe('mockbank-operator');
		expect(artifact.params).toEqual(golden.params);
		expect(artifact.outputs.map((output) => [output.name, output.type.kind, output.sensitive])).toEqual(
			golden.outputs.map((output) => [output.name, output.type.kind, output.sensitive]),
		);
		expect(artifact.app).toEqual(golden.app);
	});

	it('classifies every step with the policy (the hand-written golden may record a lower risk; replay takes the max)', async () => {
		const artifact = await compile(trace);
		expect(artifact.steps.map((step) => step.risk)).toEqual([
			'read',
			'reversible',
			'reversible',
			'reversible',
			'reversible',
			'reversible',
			'read',
			'read',
		]);
	});

	it('every screen-changing step carries a checkpoint (invariant 5)', async () => {
		const artifact = await compile(trace);
		const changing = new Set<string>(SCREEN_CHANGING_KINDS);
		for (const step of artifact.steps) if (changing.has(step.kind)) expect(step.checkpoint).toBeDefined();
	});

	it('builds locator ladders from the fingerprints (form rows for inputs, role for buttons, cells by row label)', async () => {
		const artifact = await compile(trace);
		const target = (index: number) => {
			const step = artifact.steps[index];
			return step !== undefined && 'target' in step ? step.target : undefined;
		};
		expect(target(1)?.ladder[0]).toMatchObject({ anchor: { kind: 'form_row', labelText: 'User ID' } });
		expect(target(3)?.ladder[0]).toMatchObject({ kind: 'role', role: 'button', name: 'Sign On' });
		expect(target(4)?.ladder[0]).toMatchObject({ anchor: { kind: 'form_row', labelText: 'Member #' } });
		expect(target(6)?.ladder[0]).toMatchObject({
			anchor: { kind: 'table_cell_relative', headerText: 'Share Savings', direction: 'right', offset: 1 },
		});
		expect(target(7)?.ladder[0]).toMatchObject({ anchor: { kind: 'table_cell_relative', headerText: 'Member Name' } });
	});

	it('assigns stable, readable step ids and deterministic output', async () => {
		const first = await compile(trace);
		const second = await compile(trace);
		expect(second).toEqual(first);
		expect(first.steps.map((step) => step.id)).toEqual([
			's01-open-app',
			's02-fill-user-id',
			's03-fill-password',
			's04-click-sign-on',
			's05-fill-member',
			's06-click-search',
			's07-extract-savings-balance',
			's08-extract-member-name',
		]);
	});

	it('records provenance, copies the profile outcome rules and writes a deterministic summary', async () => {
		const artifact = await compile(trace);
		expect(artifact.provenance).toEqual({
			discoveryRunId: RUN_ID,
			compiledAt: '2026-09-29T10:20:00.000Z',
			compilerVersion: ArtifactCompiler.VERSION,
			model: 'scripted:member-lookup',
			humanStepIds: [],
		});
		expect(artifact.outcomeRules).toEqual(profile.conditions);
		expect(artifact.summary.does).toContain('Look up member {{memberId}}');
		expect(artifact.summary.needs).toContain('memberId');
		expect(artifact.summary.needs).toContain('mockbank-operator');
		expect(artifact.summary.returns).toContain('savingsBalance');
		expect(artifact.summary.returns).toContain('member_not_found');
	});

	it('never contains a concrete value', async () => {
		const artifact = await compile(trace);
		expect(() =>
			assertNoConcreteValues(artifact, {
				exampleInputs: ['12345'],
				credentials: ['teller01', 'synthetic-pass-01'],
				extracted: ['1523.47', 'Jane Sample'],
			}),
		).not.toThrow();
	});

	it('keeps only performed steps and collapses repeated fills of the same target', async () => {
		const steps = [...trace.steps];
		const fill = steps[2];
		const click = steps[4];
		if (fill === undefined || click === undefined) throw new Error('fixture');
		const refused: TraceStep = {
			...click,
			verdict: 'refused',
			errorCode: 'POLICY_DENIED',
			diff: null,
			digestAfter: null,
		};
		const failed: TraceStep = { ...click, verdict: 'failed', errorCode: 'REF_UNKNOWN', diff: null, digestAfter: null };
		steps.splice(3, 0, { ...fill }, refused, failed);
		const artifact = await compile(withSteps(steps));
		expect(artifact.steps.map((step) => step.kind)).toEqual(golden.steps.map((step) => step.kind));
	});

	it('lists steps recorded from a human operator in provenance.humanStepIds', async () => {
		const steps = trace.steps.map((step, index) =>
			index === 6 ? { ...step, actor: 'human' as const, operator: 'operator:ops-1' } : step,
		);
		const artifact = await compile(withSteps(steps));
		expect(artifact.provenance.humanStepIds).toEqual(['s06-click-search']);
	});

	it('fails with UncheckpointableStepError when a screen-changing step changed nothing verifiable', async () => {
		const steps = trace.steps.map((step, index) =>
			index === 4 && step.diff !== null
				? {
						...step,
						diff: { ...step.diff, titleChanges: [], headingsAdded: [], elementsAdded: [], routeChanges: [] },
					}
				: step,
		);
		await expect(compile(withSteps(steps))).rejects.toBeInstanceOf(UncheckpointableStepError);
	});

	it('refuses a trace that did not meet its goal', async () => {
		await expect(compile({ ...trace, finish: null })).rejects.toMatchObject({
			constructor: ArtifactCompileError,
			code: 'GOAL_NOT_MET',
		});
	});

	describe('human-typed values (invariant 3)', () => {
		const humanFill = (value: string, sensitive: boolean): DiscoveryTrace =>
			withSteps(
				trace.steps.map((step, index) =>
					index === 5
						? {
								...step,
								actor: 'human' as const,
								operator: 'operator:ops-1',
								action: { kind: 'fill' as const, value: { kind: 'literal' as const, value }, sensitive },
							}
						: step,
				),
			);

		async function failure(source: DiscoveryTrace): Promise<Error> {
			let caught: unknown;
			try {
				await compile(source);
			} catch (error) {
				caught = error;
			}
			expect(caught).toBeInstanceOf(Error);
			return caught as Error;
		}

		it.each(['24680', '900-12-3456'])(
			'refuses a sensitive human fill of %s that is not a declared param, naming neither the value',
			async (value) => {
				const error = await failure(humanFill(value, true));
				expect(error).toBeInstanceOf(UnparameterizedSensitiveValueError);
				expect((error as UnparameterizedSensitiveValueError).code).toBe('UNPARAMETERIZED_SENSITIVE_VALUE');
				expect((error as UnparameterizedSensitiveValueError).stepIndex).toBe(5);
				expect(error.message).not.toContain(value);
				expect(error.message).not.toContain('24680');
				expect(error.message).not.toContain('900-12-3456');
			},
		);

		it.each(['24680', '900-12-3456', 'Jane Sample'])(
			'refuses a non-sensitive literal fill of %s that matches a redaction rule (path only, never the value)',
			async (value) => {
				const error = await failure(humanFill(value, false));
				expect(error).toBeInstanceOf(ConcreteValueLeakError);
				expect((error as ConcreteValueLeakError).path).toMatch(/^steps\[4\]\.(description|value\.value)$/);
				expect(error.message).not.toContain(value);
			},
		);

		it('still compiles a non-sensitive literal that matches no redaction rule', async () => {
			const artifact = await compile(humanFill('Holiday Club', false), { sensitiveValues: ['12345'] });
			const step = artifact.steps[4];
			expect(step).toMatchObject({ kind: 'fill', value: { kind: 'literal', value: 'Holiday Club' }, sensitive: false });
		});
	});
});
