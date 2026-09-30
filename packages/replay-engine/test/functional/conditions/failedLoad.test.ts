import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RunResultSchema, type AppProfile, type CapabilityArtifact } from '@idp/artifact-schema';
import { launchMockBank, type MockBank } from '@idp/surface/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { actionsAt, expectNoSecrets, loadFixture, loadProfile, recoveriesOf, runReplay } from '../replayHarness.js';

describe('runtime condition failed_load (recoverable, step 40)', () => {
	let bank: MockBank;
	let root: string;
	let fixture: CapabilityArtifact;
	let profile: AppProfile;

	beforeAll(async () => {
		bank = await launchMockBank({ tenant: 'a' });
		root = await mkdtemp(path.join(tmpdir(), 'idp-replay-failed-load-'));
		[fixture, profile] = await Promise.all([loadFixture('member-lookup'), loadProfile()]);
	});
	afterEach(async () => {
		await bank.reset();
	});
	afterAll(async () => {
		await bank?.stop();
		if (root !== undefined) await rm(root, { recursive: true, force: true });
	});

	it('one 503 on Member Inquiry: reload from the entry route, re-run s05, retry s06 → success', async () => {
		await bank.setFault('failed_load', { mode: 'once', route: '/member/detail' });
		const run = await runReplay({
			bank,
			root,
			artifact: fixture,
			params: { memberId: '12345' },
			profile,
			options: { retry: { backoffMs: 100 } },
		});
		expect(RunResultSchema.parse(run.result)).toMatchObject({
			kind: 'success',
			outputs: { savingsBalance: '1523.47' },
			recoveries: 1,
		});
		expect(run.entries.find((entry) => entry.kind === 'condition_detected')).toMatchObject({
			code: 'failed_load',
			class: 'recoverable',
			stepId: 's06-click-search',
		});
		expect(recoveriesOf(run)).toEqual([
			{
				code: 'failed_load',
				recoveryKind: 'retry',
				attempt: 1,
				budget: 2,
				outcome: 'succeeded',
				stepId: 's06-click-search',
			},
		]);
		expect(actionsAt(run, 's06-click-search', 'navigate')).toBe(1); // the reload of the entry route
		expect(actionsAt(run, 's05-fill-member-id')).toBe(2);
		expect(actionsAt(run, 's06-click-search', 'click')).toBe(2);
		expectNoSecrets(run);
	});

	it('a 503 on the sign-on landing page: the reload shows Member Search, so s04 holds without re-running', async () => {
		await bank.setFault('failed_load', { mode: 'once' }); // content pages: first hit is /member/search after sign-on
		const run = await runReplay({
			bank,
			root,
			artifact: fixture,
			params: { memberId: '12345' },
			profile,
			options: { retry: { backoffMs: 100 } },
		});
		expect(RunResultSchema.parse(run.result)).toMatchObject({ kind: 'success', recoveries: 1 });
		expect(recoveriesOf(run)).toEqual([
			{
				code: 'failed_load',
				recoveryKind: 'retry',
				attempt: 1,
				budget: 2,
				outcome: 'succeeded',
				stepId: 's04-click-sign-on',
			},
		]);
		expect(actionsAt(run, 's04-click-sign-on', 'click')).toBe(1);
		expectNoSecrets(run);
	});

	it('failed_load_persistent: every retry fails → failure recovery_exhausted at s06 with evidence refs', async () => {
		await bank.setFault('failed_load_persistent', { route: '/member/detail' });
		const run = await runReplay({
			bank,
			root,
			artifact: fixture,
			params: { memberId: '12345' },
			profile,
			options: { retry: { backoffMs: 100 } },
		});
		const result = RunResultSchema.parse(run.result);
		expect(result).toMatchObject({
			kind: 'failure',
			reason: 'recovery_exhausted',
			step: { index: 5, id: 's06-click-search' },
		});
		if (result.kind !== 'failure') throw new Error('unreachable');
		expect(result.expected).toContain('within 2 retries');
		expect(result.evidence.map((ref) => ref.kind).sort()).toEqual(['a11y_snapshot', 'screenshot']);
		expect(recoveriesOf(run).map(({ attempt, outcome }) => [attempt, outcome])).toEqual([
			[1, 'failed'],
			[2, 'failed'],
		]);
		expect(actionsAt(run, 's06-click-search', 'click')).toBe(3);
		expectNoSecrets(run);
	});
});
