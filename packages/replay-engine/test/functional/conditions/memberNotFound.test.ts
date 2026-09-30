import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RunResultSchema, type AppProfile, type CapabilityArtifact } from '@idp/artifact-schema';
import { launchMockBank, type MockBank } from '@idp/surface/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { expectNoSecrets, loadFixture, loadProfile, runReplay, type Run } from '../replayHarness.js';

/** The exact business outcome (AC6): never a failure, no retry, stopped at the Search step. */
function expectMemberNotFound(run: Run): void {
	expect(RunResultSchema.parse(run.result)).toMatchObject({
		kind: 'business_outcome',
		code: 'member_not_found',
		stepId: 's06-click-search',
		message: 'No records match your search criteria',
	});
	const { entries } = run;
	expect(entries.find((entry) => entry.kind === 'condition_detected')).toMatchObject({
		code: 'member_not_found',
		class: 'business_outcome',
		stepId: 's06-click-search',
	});
	expect(entries.find((entry) => entry.kind === 'checkpoint' && entry.stepId === 's06-click-search')).toMatchObject({
		result: 'condition',
	});
	// Stopped cleanly: no later step ran, no retry of the Search click, no recovery, no intervention.
	const actions = entries.filter((entry) => entry.kind === 'action');
	expect(actions.at(-1)).toMatchObject({ stepId: 's06-click-search' });
	expect(actions.filter((entry) => entry.stepId === 's06-click-search')).toHaveLength(1);
	expect(entries.some((entry) => entry.kind === 'recovery' || entry.kind === 'intervention')).toBe(false);
	expect(entries.filter((entry) => entry.kind !== 'lease_change').at(-1)).toMatchObject({
		kind: 'result',
		resultKind: 'business_outcome',
		code: 'member_not_found',
	});
	expect(JSON.parse(run.resultText)).toMatchObject({ kind: 'business_outcome', code: 'member_not_found' });
}

describe('runtime condition member_not_found (business_outcome, AC6)', () => {
	let bank: MockBank;
	let root: string;
	let fixture: CapabilityArtifact;
	let profile: AppProfile;

	beforeAll(async () => {
		bank = await launchMockBank({ tenant: 'a' });
		root = await mkdtemp(path.join(tmpdir(), 'idp-replay-not-found-'));
		[fixture, profile] = await Promise.all([loadFixture('member-lookup'), loadProfile()]);
	});
	afterEach(async () => {
		await bank.reset();
	});
	afterAll(async () => {
		await bank?.stop();
		if (root !== undefined) await rm(root, { recursive: true, force: true });
	});

	it('natural trigger: unknown member 99999 → exactly business_outcome member_not_found at s06', async () => {
		const run = await runReplay({ bank, root, artifact: fixture, params: { memberId: '99999' }, profile });
		expectMemberNotFound(run);
		expectNoSecrets(run, ['99999']);
	});

	it('injected fault: member_not_found on /member/detail for the seeded 12345 → the same outcome', async () => {
		await bank.setFault('member_not_found', { mode: 'once' });
		const run = await runReplay({ bank, root, artifact: fixture, params: { memberId: '12345' } });
		expectMemberNotFound(run);
		expectNoSecrets(run);
	});
});
