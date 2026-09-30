import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RunResultSchema, type AppProfile, type CapabilityArtifact } from '@idp/artifact-schema';
import { launchMockBank, type MockBank } from '@idp/surface/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	actionsAt,
	expectNoSecrets,
	loadFixture,
	loadProfile,
	recoveriesOf,
	runReplay,
	withStep,
} from '../replayHarness.js';

/**
 * Timing (≥ 3× margins): s06's own bound is 500 ms (a test copy of the fixture); the slow page takes 1 500 ms;
 * the slow-load budget is 4 500 ms; the "failed" slow page takes 30 000 ms (abandoned at the budget).
 */
const STEP_BOUND_MS = 500;
const SLOW_MS = 1_500;
const BUDGET_MS = 4_500;
const TOO_SLOW_MS = 30_000;

describe('runtime condition slow_load (recoverable, step 39)', () => {
	let bank: MockBank;
	let root: string;
	let fixture: CapabilityArtifact;
	let profile: AppProfile;

	beforeAll(async () => {
		bank = await launchMockBank({ tenant: 'a' });
		root = await mkdtemp(path.join(tmpdir(), 'idp-replay-slow-load-'));
		[fixture, profile] = await Promise.all([loadFixture('member-lookup'), loadProfile()]);
	});
	afterEach(async () => {
		await bank.reset();
	});
	afterAll(async () => {
		await bank?.stop();
		if (root !== undefined) await rm(root, { recursive: true, force: true });
	});

	const slowSearch = () => withStep(fixture, 's06-click-search', (step) => ({ ...step, timeoutMs: STEP_BOUND_MS }));
	const options = { slowLoadBudgetMs: BUDGET_MS, retry: { backoffMs: 100 } };

	it('slower than the step bound, within the budget: one bounded wait, logged; success', async () => {
		await bank.setFault('slow_load', { mode: 'once', route: '/member/detail', delayMs: SLOW_MS });
		const run = await runReplay({
			bank,
			root,
			artifact: await slowSearch(),
			params: { memberId: '12345' },
			profile,
			options,
		});
		expect(RunResultSchema.parse(run.result)).toMatchObject({
			kind: 'success',
			outputs: { savingsBalance: '1523.47' },
		});
		expect(run.entries.find((entry) => entry.kind === 'condition_detected')).toMatchObject({
			code: 'slow_load',
			class: 'recoverable',
			stepId: 's06-click-search',
		});
		expect(recoveriesOf(run)).toContainEqual({
			code: 'slow_load',
			recoveryKind: 'retry',
			attempt: 1,
			budget: 1,
			outcome: 'succeeded',
			stepId: 's06-click-search',
		});
		expect(actionsAt(run, 's06-click-search', 'click')).toBe(1);
		expectNoSecrets(run);
	});

	it('past the budget: treated as a failed load and retried (the retry is fast) → success', async () => {
		await bank.setFault('slow_load', { mode: 'once', route: '/member/detail', delayMs: TOO_SLOW_MS });
		const run = await runReplay({
			bank,
			root,
			artifact: await slowSearch(),
			params: { memberId: '12345' },
			profile,
			options,
		});
		expect(RunResultSchema.parse(run.result)).toMatchObject({ kind: 'success' });
		const s06 = recoveriesOf(run).filter((entry) => entry.stepId === 's06-click-search');
		expect(s06).toEqual([
			{
				code: 'slow_load',
				recoveryKind: 'retry',
				attempt: 1,
				budget: 1,
				outcome: 'failed',
				stepId: 's06-click-search',
			},
			{
				code: 'failed_load',
				recoveryKind: 'retry',
				attempt: 1,
				budget: 2,
				outcome: 'succeeded',
				stepId: 's06-click-search',
			},
		]);
		expect(run.entries.filter((entry) => entry.kind === 'condition_detected').map((entry) => entry.code)).toEqual([
			'slow_load',
			'failed_load',
		]);
		expectNoSecrets(run);
	});

	it('past the budget every time (retry.max 1): failure recovery_exhausted at s06', async () => {
		await bank.setFault('slow_load', { mode: 'always', route: '/member/detail', delayMs: TOO_SLOW_MS });
		const run = await runReplay({
			bank,
			root,
			artifact: await slowSearch(),
			params: { memberId: '12345' },
			profile,
			options: { ...options, retry: { max: 1, backoffMs: 100 } },
		});
		expect(RunResultSchema.parse(run.result)).toMatchObject({
			kind: 'failure',
			reason: 'recovery_exhausted',
			step: { index: 5, id: 's06-click-search' },
		});
		expect(recoveriesOf(run).filter((entry) => entry.code === 'failed_load')).toEqual([
			{
				code: 'failed_load',
				recoveryKind: 'retry',
				attempt: 1,
				budget: 1,
				outcome: 'failed',
				stepId: 's06-click-search',
			},
		]);
		expectNoSecrets(run);
	});
});
