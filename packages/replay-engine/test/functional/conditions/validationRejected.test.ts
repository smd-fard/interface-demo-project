import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RunResultSchema, type CapabilityArtifact } from '@idp/artifact-schema';
import { launchMockBank, type MockBank } from '@idp/surface/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { expectNoSecrets, loadFixture, rehashed, runReplay } from '../replayHarness.js';

/** The value the app rejects: five characters, not five digits. Sensitive (it is a memberId value). */
const REJECTED = '12a45';

describe('runtime condition validation_rejected (business_outcome, AC8)', () => {
	let bank: MockBank;
	let root: string;
	let fixture: CapabilityArtifact;
	/** A test copy whose memberId pattern is loosened, so the app — not the param schema — rejects the value. */
	let loosened: CapabilityArtifact;

	beforeAll(async () => {
		bank = await launchMockBank({ tenant: 'a' });
		root = await mkdtemp(path.join(tmpdir(), 'idp-replay-validation-'));
		fixture = await loadFixture('member-lookup');
		loosened = await rehashed({
			...fixture,
			version: `${fixture.version}-loosened`,
			params: fixture.params.map((param) =>
				param.name === 'memberId' ? { ...param, type: { kind: 'string', pattern: '^[0-9a-z]{5}$' } } : param,
			),
		});
	});
	afterEach(async () => {
		await bank.reset();
	});
	afterAll(async () => {
		await bank?.stop();
		if (root !== undefined) await rm(root, { recursive: true, force: true });
	});

	it('the app rejects "12a45" → business_outcome validation_rejected at s06; the message is redacted', async () => {
		const run = await runReplay({ bank, root, artifact: loosened, params: { memberId: REJECTED } });
		expect(RunResultSchema.parse(run.result)).toMatchObject({
			kind: 'business_outcome',
			code: 'validation_rejected',
			stepId: 's06-click-search',
			message: 'Invalid Member Number',
		});
		expect(run.entries.find((entry) => entry.kind === 'condition_detected')).toMatchObject({
			code: 'validation_rejected',
			class: 'business_outcome',
		});
		// The fill ran with the value, but it reached no sink.
		expect(run.entries.some((entry) => entry.kind === 'action' && entry.stepId === 's05-fill-member-id')).toBe(true);
		expectNoSecrets(run, [REJECTED]);
	});

	it('injected fault: validation_error on /member/detail for a valid 12345 → business_outcome validation_rejected', async () => {
		await bank.setFault('validation_error', { mode: 'once' });
		const run = await runReplay({ bank, root, artifact: fixture, params: { memberId: '12345' } });
		expect(RunResultSchema.parse(run.result)).toMatchObject({
			kind: 'business_outcome',
			code: 'validation_rejected',
			stepId: 's06-click-search',
		});
		expectNoSecrets(run);
	});

	it('the fixture pattern rejects "12a45" first → failure invalid_params with zero surface calls (AC8)', async () => {
		const run = await runReplay({ bank, root, artifact: fixture, params: { memberId: REJECTED } });
		expect(RunResultSchema.parse(run.result)).toMatchObject({
			kind: 'failure',
			reason: 'invalid_params',
			step: null,
			evidence: [],
		});
		const kinds = run.entries.map((entry) => entry.kind).filter((kind) => kind !== 'lease_change');
		expect(kinds).toEqual(['run_started', 'result']);
		expectNoSecrets(run, [REJECTED]);
	});
});
