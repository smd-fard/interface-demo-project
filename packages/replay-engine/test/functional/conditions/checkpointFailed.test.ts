import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RunResultSchema, type AppProfile, type CapabilityArtifact } from '@idp/artifact-schema';
import { launchMockBank, type MockBank } from '@idp/surface/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { actionsAt, expectNoSecrets, loadFixture, loadProfile, runReplay } from '../replayHarness.js';

describe('runtime condition checkpoint_failed (failure, step 44) — injected with the wrong_screen fault', () => {
	let bank: MockBank;
	let root: string;
	let fixture: CapabilityArtifact;
	let profile: AppProfile;

	beforeAll(async () => {
		bank = await launchMockBank({ tenant: 'a' });
		root = await mkdtemp(path.join(tmpdir(), 'idp-replay-checkpoint-failed-'));
		[fixture, profile] = await Promise.all([loadFixture('member-lookup'), loadProfile()]);
	});
	afterEach(async () => {
		await bank.reset();
	});
	afterAll(async () => {
		await bank?.stop();
		if (root !== undefined) await rm(root, { recursive: true, force: true });
	});

	it('Search lands on "Account Summary" (HTTP 200, no rule matches): failure checkpoint_failed at s06 with expected, observed and evidence', async () => {
		await bank.setFault('wrong_screen', { mode: 'once' });
		const run = await runReplay({
			bank,
			root,
			artifact: fixture, // the unedited fixture: the screen is wrong, not the artifact
			params: { memberId: '12345' },
			profile,
			options: { checkpointTimeoutMs: 1_500 },
		});
		const result = RunResultSchema.parse(run.result);
		expect(result).toMatchObject({
			kind: 'failure',
			reason: 'checkpoint_failed',
			step: { index: 5, id: 's06-click-search' },
			expected: 'text "Member Inquiry" present in frame content',
			observed: 'text "Member Inquiry" not present in the scoped frame',
		});
		if (result.kind !== 'failure') throw new Error('unreachable');
		expect(result.evidence.map((ref) => ref.kind).sort()).toEqual(['a11y_snapshot', 'screenshot']);
		// No condition was detected (a mismatch is not a runtime condition), and the click ran exactly once.
		expect(run.entries.some((entry) => entry.kind === 'condition_detected')).toBe(false);
		expect(actionsAt(run, 's06-click-search', 'click')).toBe(1);
		expect(
			run.entries.find((entry) => entry.kind === 'checkpoint' && entry.stepId === 's06-click-search'),
		).toMatchObject({
			result: 'failed',
		});
		expectNoSecrets(run);
	});
});
