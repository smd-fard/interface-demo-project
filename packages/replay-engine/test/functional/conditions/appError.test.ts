import { access, mkdtemp, rm } from 'node:fs/promises';
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
	readManifest,
	recoveriesOf,
	runReplay,
} from '../replayHarness.js';

describe('runtime condition app_error (failure, step 43)', () => {
	let bank: MockBank;
	let root: string;
	let fixture: CapabilityArtifact;
	let profile: AppProfile;

	beforeAll(async () => {
		bank = await launchMockBank({ tenant: 'a' });
		root = await mkdtemp(path.join(tmpdir(), 'idp-replay-app-error-'));
		[fixture, profile] = await Promise.all([loadFixture('member-lookup'), loadProfile()]);
	});
	afterEach(async () => {
		await bank.reset();
	});
	afterAll(async () => {
		await bank?.stop();
		if (root !== undefined) await rm(root, { recursive: true, force: true });
	});

	it('the server error page at Member Inquiry: failure app_error at s06 with evidence listed in the manifest (AC13)', async () => {
		await bank.setFault('app_error', { mode: 'once', route: '/member/detail' });
		const run = await runReplay({ bank, root, artifact: fixture, params: { memberId: '12345' }, profile });
		const result = RunResultSchema.parse(run.result);
		expect(result).toMatchObject({ kind: 'failure', reason: 'app_error', step: { index: 5, id: 's06-click-search' } });
		if (result.kind !== 'failure') throw new Error('unreachable');
		expect(result.observed).toContain('matched "Server Error"');
		expect(result.interventionRequestId).toBeDefined();
		expect(result.evidence.map((ref) => ref.kind).sort()).toEqual(['a11y_snapshot', 'screenshot']);
		const manifest = await readManifest(run);
		expect(manifest.resultKind).toBe('failure');
		for (const ref of result.evidence) {
			expect(manifest.evidence).toContainEqual(ref);
			await access(run.session.runDir.resolve(ref.path));
		}
		expect(run.entries.find((entry) => entry.kind === 'condition_detected')).toMatchObject({
			code: 'app_error',
			class: 'failure',
			stepId: 's06-click-search',
		});
		// A failure is not retried: no recovery, the Search click ran once.
		expect(recoveriesOf(run)).toEqual([]);
		expect(actionsAt(run, 's06-click-search', 'click')).toBe(1);
		expectNoSecrets(run);
	});
});
