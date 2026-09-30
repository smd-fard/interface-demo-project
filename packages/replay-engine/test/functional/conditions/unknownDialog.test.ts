import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RunResultSchema, type AppProfile, type CapabilityArtifact } from '@idp/artifact-schema';
import { launchMockBank, type MockBank } from '@idp/surface/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { expectNoSecrets, loadFixture, loadProfile, readManifest, recoveriesOf, runReplay } from '../replayHarness.js';

describe('runtime condition unknown_dialog (failure, step 42)', () => {
	let bank: MockBank;
	let root: string;
	let fixture: CapabilityArtifact;
	let profile: AppProfile;

	beforeAll(async () => {
		bank = await launchMockBank({ tenant: 'a' });
		root = await mkdtemp(path.join(tmpdir(), 'idp-replay-unknown-dialog-'));
		[fixture, profile] = await Promise.all([loadFixture('member-lookup'), loadProfile()]);
	});
	afterEach(async () => {
		await bank.reset();
	});
	afterAll(async () => {
		await bank?.stop();
		if (root !== undefined) await rm(root, { recursive: true, force: true });
	});

	it('an unrecognised confirm: failure unknown_dialog at s06, left unaccepted, request ref, blocked-page snapshot', async () => {
		await bank.setFault('unknown_dialog', { mode: 'once' });
		const run = await runReplay({ bank, root, artifact: fixture, params: { memberId: '12345' }, profile });
		const result = RunResultSchema.parse(run.result);
		expect(result).toMatchObject({
			kind: 'failure',
			reason: 'unknown_dialog',
			step: { index: 5, id: 's06-click-search' },
		});
		if (result.kind !== 'failure') throw new Error('unreachable');
		// Unattended escalation: the takeover request is persisted and referenced.
		expect(result.interventionRequestId).toBeDefined();
		expect(result.observed).toContain('a native confirm dialog no rule recognises is pending; it is left unaccepted');
		// Chromium cannot screenshot (or read the DOM of) a page blocked by a native dialog, and the run never
		// settles it: the a11y snapshot of what is observable is stored; no screenshot ref is faked.
		expect(result.observed).toContain('screenshot not captured (DIALOG_PENDING');
		expect(result.evidence.map((ref) => ref.kind)).toEqual(['a11y_snapshot']);
		const manifest = await readManifest(run);
		for (const ref of result.evidence) {
			expect(manifest.evidence.map((listed) => listed.id)).toContain(ref.id);
			await access(run.session.runDir.resolve(ref.path));
		}
		expect(run.entries.find((entry) => entry.kind === 'condition_detected')).toMatchObject({
			code: 'unknown_dialog',
			class: 'failure',
			stepId: 's06-click-search',
		});
		expect(run.entries.some((entry) => entry.kind === 'action' && entry.actionKind === 'dismiss_dialog')).toBe(false);
		expect(recoveriesOf(run)).toEqual([]);
		expectNoSecrets(run);
	});
});
