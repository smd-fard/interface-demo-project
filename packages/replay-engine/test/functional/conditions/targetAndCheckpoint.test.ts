import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RunResultSchema, type AppProfile, type CapabilityArtifact } from '@idp/artifact-schema';
import { launchMockBank, type MockBank } from '@idp/surface/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { expectNoSecrets, loadFixture, loadProfile, runReplay, withStep } from '../replayHarness.js';

describe('runtime conditions target_unresolved and checkpoint_failed (failure, step 44)', () => {
	let bank: MockBank;
	let root: string;
	let fixture: CapabilityArtifact;
	let profile: AppProfile;

	beforeAll(async () => {
		bank = await launchMockBank({ tenant: 'a' });
		root = await mkdtemp(path.join(tmpdir(), 'idp-replay-target-checkpoint-'));
		[fixture, profile] = await Promise.all([loadFixture('member-lookup'), loadProfile()]);
	});
	afterEach(async () => {
		await bank.reset();
	});
	afterAll(async () => {
		await bank?.stop();
		if (root !== undefined) await rm(root, { recursive: true, force: true });
	});

	it('control_missing: failure target_unresolved at s06, observed lists every rung with its match count', async () => {
		await bank.setFault('control_missing', { mode: 'once' });
		const run = await runReplay({ bank, root, artifact: fixture, params: { memberId: '12345' }, profile });
		const result = RunResultSchema.parse(run.result);
		expect(result).toMatchObject({
			kind: 'failure',
			reason: 'target_unresolved',
			step: { index: 5, id: 's06-click-search' },
		});
		if (result.kind !== 'failure') throw new Error('unreachable');
		expect(result.observed).toBe('rung 0 role: 0 matches; rung 1 text: 0 matches; rung 2 structural: 0 matches');
		expect(result.evidence.map((ref) => ref.kind).sort()).toEqual(['a11y_snapshot', 'screenshot']);
		expectNoSecrets(run);
	});

	it('late_render: a Search button rendered 1.5 s after the page is waited for (bounded), not target_unresolved', async () => {
		await bank.setFault('late_render', { mode: 'once', delayMs: 1_500 });
		const run = await runReplay({ bank, root, artifact: fixture, params: { memberId: '12345' }, profile });
		expect(RunResultSchema.parse(run.result)).toMatchObject({ kind: 'success', drift: [] });
		expect(
			run.entries.find((entry) => entry.kind === 'locator_resolved' && entry.stepId === 's06-click-search'),
		).toMatchObject({
			rungIndex: 0,
		});
		expectNoSecrets(run);
	});

	it('a checkpoint that does not hold (a fixture copy expecting "Member Enquiry"): checkpoint_failed with expected vs observed', async () => {
		const artifact = await withStep(fixture, 's06-click-search', (step) =>
			step.kind === 'click'
				? {
						...step,
						checkpoint: { kind: 'text_present', text: 'Member Enquiry', frame: [{ kind: 'by_name', name: 'content' }] },
					}
				: step,
		);
		const run = await runReplay({
			bank,
			root,
			artifact,
			params: { memberId: '12345' },
			profile,
			options: { checkpointTimeoutMs: 1_500 },
		});
		const result = RunResultSchema.parse(run.result);
		expect(result).toMatchObject({
			kind: 'failure',
			reason: 'checkpoint_failed',
			step: { index: 5, id: 's06-click-search' },
			expected: 'text "Member Enquiry" present in frame content',
		});
		if (result.kind !== 'failure') throw new Error('unreachable');
		expect(result.observed).toContain('Member Enquiry');
		expect(result.evidence.map((ref) => ref.kind).sort()).toEqual(['a11y_snapshot', 'screenshot']);
		expectNoSecrets(run);
	});
});
