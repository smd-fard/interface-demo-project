import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RunResultSchema, type AppProfile, type CapabilityArtifact } from '@idp/artifact-schema';
import { launchMockBank, type MockBank } from '@idp/surface/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { actionsAt, expectNoSecrets, loadFixture, loadProfile, recoveriesOf, runReplay } from '../replayHarness.js';

describe('runtime condition session_timeout (recoverable, step 41)', () => {
	let bank: MockBank;
	let root: string;
	let fixture: CapabilityArtifact;
	let profile: AppProfile;

	beforeAll(async () => {
		bank = await launchMockBank({ tenant: 'a' });
		root = await mkdtemp(path.join(tmpdir(), 'idp-replay-session-timeout-'));
		[fixture, profile] = await Promise.all([loadFixture('member-lookup'), loadProfile()]);
	});
	afterEach(async () => {
		await bank.reset();
	});
	afterAll(async () => {
		await bank?.stop();
		if (root !== undefined) await rm(root, { recursive: true, force: true });
	});

	it('one expiry at Member Inquiry: sign on again, re-run s05, retry s06 → success, reauth logged', async () => {
		await bank.setFault('session_timeout', { mode: 'once', route: '/member/detail' });
		const run = await runReplay({ bank, root, artifact: fixture, params: { memberId: '12345' }, profile });
		expect(RunResultSchema.parse(run.result)).toMatchObject({
			kind: 'success',
			outputs: { savingsBalance: '1523.47' },
			recoveries: 1,
		});
		expect(run.entries.find((entry) => entry.kind === 'condition_detected')).toMatchObject({
			code: 'session_timeout',
			class: 'recoverable',
			stepId: 's06-click-search',
		});
		expect(recoveriesOf(run)).toEqual([
			{
				code: 'session_timeout',
				recoveryKind: 'reauth',
				attempt: 1,
				budget: 1,
				outcome: 'succeeded',
				stepId: 's06-click-search',
			},
		]);
		for (const stepId of [
			's01-open-app',
			's02-fill-user-id',
			's03-fill-password',
			's04-click-sign-on',
			's05-fill-member-id',
		]) {
			expect(actionsAt(run, stepId), stepId).toBe(2);
		}
		expectNoSecrets(run);
	});

	it('an expiry during sign-on (the landing page): the login steps re-run, then s04 again → success', async () => {
		await bank.setFault('session_timeout', { mode: 'once' });
		const run = await runReplay({ bank, root, artifact: fixture, params: { memberId: '12345' }, profile });
		expect(RunResultSchema.parse(run.result)).toMatchObject({ kind: 'success', recoveries: 1 });
		expect(recoveriesOf(run)).toEqual([
			{
				code: 'session_timeout',
				recoveryKind: 'reauth',
				attempt: 1,
				budget: 1,
				outcome: 'succeeded',
				stepId: 's04-click-sign-on',
			},
		]);
		expect(actionsAt(run, 's04-click-sign-on')).toBe(2);
		expect(actionsAt(run, 's05-fill-member-id')).toBe(1);
		expectNoSecrets(run);
	});

	it('a second expiry (fault always): failure session_lost at s06 after one re-auth', async () => {
		await bank.setFault('session_timeout', { mode: 'always', route: '/member/detail' });
		const run = await runReplay({ bank, root, artifact: fixture, params: { memberId: '12345' }, profile });
		const result = RunResultSchema.parse(run.result);
		expect(result).toMatchObject({
			kind: 'failure',
			reason: 'session_lost',
			step: { index: 5, id: 's06-click-search' },
		});
		expect(recoveriesOf(run)).toEqual([
			{
				code: 'session_timeout',
				recoveryKind: 'reauth',
				attempt: 1,
				budget: 1,
				outcome: 'failed',
				stepId: 's06-click-search',
			},
		]);
		expectNoSecrets(run);
	});
});
