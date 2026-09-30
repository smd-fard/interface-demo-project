import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RunResultSchema, type AppProfile, type CapabilityArtifact } from '@idp/artifact-schema';
import { launchMockBank, type MockBank } from '@idp/surface/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { actionsAt, expectNoSecrets, loadFixture, loadProfile, recoveriesOf, runReplay } from '../replayHarness.js';

describe('runtime condition known_dialog (recoverable, step 38)', () => {
	let bank: MockBank;
	let root: string;
	let fixture: CapabilityArtifact;
	let profile: AppProfile;

	beforeAll(async () => {
		bank = await launchMockBank({ tenant: 'a' });
		root = await mkdtemp(path.join(tmpdir(), 'idp-replay-known-dialog-'));
		[fixture, profile] = await Promise.all([loadFixture('member-lookup'), loadProfile()]);
	});
	afterEach(async () => {
		await bank.reset();
	});
	afterAll(async () => {
		await bank?.stop();
		if (root !== undefined) await rm(root, { recursive: true, force: true });
	});

	it('the maintenance alert on Member Inquiry is accepted once, logged as a recovery; the run succeeds', async () => {
		await bank.setFault('known_dialog', { mode: 'once' });
		const run = await runReplay({ bank, root, artifact: fixture, params: { memberId: '12345' }, profile });
		expect(RunResultSchema.parse(run.result)).toMatchObject({
			kind: 'success',
			outputs: { savingsBalance: '1523.47', memberName: 'Jane Sample' },
			recoveries: 1,
		});
		expect(run.entries.find((entry) => entry.kind === 'condition_detected')).toMatchObject({
			code: 'known_dialog',
			class: 'recoverable',
			stepId: 's06-click-search',
		});
		expect(recoveriesOf(run)).toEqual([
			{
				code: 'known_dialog',
				recoveryKind: 'dismiss_dialog',
				attempt: 1,
				budget: 1,
				outcome: 'succeeded',
				stepId: 's06-click-search',
			},
		]);
		// The dialog was settled through the guarded surface, and the Search click was not repeated.
		expect(actionsAt(run, 's06-click-search', 'dismiss_dialog')).toBe(1);
		expect(actionsAt(run, 's06-click-search', 'click')).toBe(1);
		expectNoSecrets(run);
	});

	it('budget 0 (maxDialogDismissPerStep: 0): failure recovery_exhausted at s06, the alert left open', async () => {
		await bank.setFault('known_dialog', { mode: 'once' });
		const run = await runReplay({
			bank,
			root,
			artifact: fixture,
			params: { memberId: '12345' },
			profile,
			options: { maxDialogDismissPerStep: 0 },
		});
		const result = RunResultSchema.parse(run.result);
		expect(result).toMatchObject({
			kind: 'failure',
			reason: 'recovery_exhausted',
			step: { index: 5, id: 's06-click-search' },
		});
		if (result.kind !== 'failure') throw new Error('unreachable');
		expect(result.observed).toContain('0 of 0 dismissal(s)');
		// A pending dialog blocks rendering: the blocked-page snapshot is stored, no screenshot is faked.
		expect(result.evidence.map((ref) => ref.kind)).toEqual(['a11y_snapshot']);
		expect(recoveriesOf(run)).toEqual([]);
		expect(actionsAt(run, 's06-click-search', 'dismiss_dialog')).toBe(0);
		expectNoSecrets(run);
	});
});
