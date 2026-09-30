import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RunResultSchema, type CapabilityArtifact } from '@idp/artifact-schema';
import { launchMockBank, type MockBank } from '@idp/surface/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { expectNoSecrets, loadFixture, runReplay } from '../replayHarness.js';

describe('runtime condition permission_denied (business_outcome)', () => {
	let bank: MockBank;
	let root: string;
	let lookup: CapabilityArtifact;
	let openSubAccount: CapabilityArtifact;

	beforeAll(async () => {
		bank = await launchMockBank({ tenant: 'a' });
		root = await mkdtemp(path.join(tmpdir(), 'idp-replay-denied-'));
		[lookup, openSubAccount] = await Promise.all([loadFixture('member-lookup'), loadFixture('open-sub-account')]);
	});
	afterEach(async () => {
		await bank.reset();
	});
	afterAll(async () => {
		await bank?.stop();
		if (root !== undefined) await rm(root, { recursive: true, force: true });
	});

	it('injected fault on /member/detail → business_outcome permission_denied at s06, not a failure', async () => {
		await bank.setFault('permission_denied', { mode: 'once', route: '/member/detail' });
		const run = await runReplay({ bank, root, artifact: lookup, params: { memberId: '12345' } });
		expect(RunResultSchema.parse(run.result)).toMatchObject({
			kind: 'business_outcome',
			code: 'permission_denied',
			stepId: 's06-click-search',
			message: 'SEC-403',
		});
		expect(run.entries.find((entry) => entry.kind === 'condition_detected')).toMatchObject({
			code: 'permission_denied',
			class: 'business_outcome',
			stepId: 's06-click-search',
		});
		expect(run.entries.some((entry) => entry.kind === 'intervention')).toBe(false);
		expectNoSecrets(run);
	});

	it('natural trigger: teller02 lacks the sub-account entitlement → permission_denied at s07 (nothing opened)', async () => {
		const run = await runReplay({
			bank,
			root,
			artifact: openSubAccount,
			params: { memberId: '12345', product: 'Holiday Club', initialDeposit: '250.00', nickname: 'Beach fund' },
			credential: { username: 'teller02', password: 'synthetic-pass-02' },
		});
		expect(RunResultSchema.parse(run.result)).toMatchObject({
			kind: 'business_outcome',
			code: 'permission_denied',
			stepId: 's07-click-open-sub-account',
		});
		// Stopped before any irreversible step: no approval was requested.
		expect(run.entries.some((entry) => entry.kind === 'action' && entry.stepId === 's12-click-confirm')).toBe(false);
		expect(run.entries.some((entry) => entry.kind === 'intervention')).toBe(false);
		expectNoSecrets(run, ['teller02', 'Beach fund']);
	});
});
