import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RunResultSchema, type CapabilityArtifact, type TargetRef } from '@idp/artifact-schema';
import { launchMockBank, SimulatedOperator, type MockBank } from '@idp/surface/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { expectNoSecrets, leasePath, loadFixture, startReplay, until } from './replayHarness.js';

const content = [{ kind: 'by_name' as const, name: 'content' }];
const nav = [{ kind: 'by_name' as const, name: 'nav' }];
const rationale = 'functional test: the operator points at it';
const memberInput: TargetRef = {
	description: 'Member # input',
	frame: content,
	ladder: [{ kind: 'structural', anchor: { kind: 'form_row', labelText: 'Member #', control: 'input' }, rationale }],
};
const searchButton: TargetRef = {
	description: 'Search button',
	frame: content,
	ladder: [{ kind: 'role', role: 'button', name: 'Search', exact: true, rationale }],
};
const SUB_ACCOUNT_PARAMS = {
	memberId: '12345',
	product: 'Holiday Club',
	initialDeposit: '250.00',
	nickname: 'Beach fund',
};

describe('replay: the approval gate and attended escalation (AC10, AC11)', () => {
	let bank: MockBank;
	let root: string;
	let lookup: CapabilityArtifact;
	let openSubAccount: CapabilityArtifact;

	beforeAll(async () => {
		bank = await launchMockBank({ tenant: 'a' });
		root = await mkdtemp(path.join(tmpdir(), 'idp-replay-handoff-'));
		[lookup, openSubAccount] = await Promise.all([loadFixture('member-lookup'), loadFixture('open-sub-account')]);
	});
	afterEach(async () => {
		await bank.reset();
	});
	afterAll(async () => {
		await bank?.stop();
		if (root !== undefined) await rm(root, { recursive: true, force: true });
	});

	it('attended approval: PAUSED with a redacted approval request, operator approves, success SA-000001 (AC10)', async () => {
		const started = await startReplay({
			bank,
			root,
			artifact: openSubAccount,
			params: SUB_ACCOUNT_PARAMS,
			attended: true,
		});
		const client = started.client;
		if (client === null) throw new Error('attended run without a control client');

		const request = await until(
			async () => (await client.interventions()).find((candidate) => candidate.kind === 'approval'),
			'the approval request',
		);
		expect(request).toMatchObject({
			kind: 'approval',
			status: 'open',
			currentStep: { index: 11, id: 's12-click-confirm', risk: 'irreversible' },
			reason: { code: 'approval_required' },
		});
		const requestText = JSON.stringify(request);
		for (const secret of ['12345', 'Beach fund', 'teller01', 'synthetic-pass-01']) {
			expect(requestText, `the approval request leaks ${secret}`).not.toContain(secret);
		}
		expect(started.session.lease.state()).toBe('PAUSED');

		await client.approve(request.id, 'ops-1');
		const run = await started.done;
		expect(RunResultSchema.parse(run.result)).toMatchObject({
			kind: 'success',
			outputs: { confirmationNumber: 'SA-000001' },
		});
		expect(leasePath(run.session)).toBe('AGENT → PAUSED → RESUMING → AGENT');
		// The Confirm click ran exactly once, with the grant; its native confirm was accepted as part of it.
		expect(run.entries.filter((entry) => entry.kind === 'action' && entry.stepId === 's12-click-confirm')).toHaveLength(
			1,
		);
		expect(
			run.entries
				.filter((entry) => entry.kind === 'intervention')
				.map((entry) => (entry.kind === 'intervention' ? entry.event : '')),
		).toEqual(['raised', 'resolved']);
		expectNoSecrets(run, ['Beach fund']);
	});

	it('unattended approval: failure approval_required with the persisted request ref; Confirm never clicked', async () => {
		const { done } = await startReplay({ bank, root, artifact: openSubAccount, params: SUB_ACCOUNT_PARAMS });
		const run = await done;
		const result = RunResultSchema.parse(run.result);
		expect(result).toMatchObject({
			kind: 'failure',
			reason: 'approval_required',
			step: { index: 11, id: 's12-click-confirm' },
		});
		if (result.kind !== 'failure') throw new Error('unreachable');
		const requestId = result.interventionRequestId;
		expect(requestId).toBeDefined();
		await access(path.join(run.session.runDir.path, 'interventions', `${requestId ?? ''}.json`));
		expect(run.entries.some((entry) => entry.kind === 'action' && entry.stepId === 's12-click-confirm')).toBe(false);
		expect(JSON.parse(run.resultText)).toMatchObject({ reason: 'approval_required', interventionRequestId: requestId });
		expectNoSecrets(run, ['Beach fund']);
	});

	it('attended approval rejected: failure approval_rejected with the request ref', async () => {
		const started = await startReplay({
			bank,
			root,
			artifact: openSubAccount,
			params: SUB_ACCOUNT_PARAMS,
			attended: true,
		});
		const client = started.client;
		if (client === null) throw new Error('attended run without a control client');
		const request = await until(
			async () => (await client.interventions()).find((candidate) => candidate.kind === 'approval'),
			'the approval request',
		);
		await client.reject(request.id, 'ops-1');
		const run = await started.done;
		expect(RunResultSchema.parse(run.result)).toMatchObject({
			kind: 'failure',
			reason: 'approval_rejected',
			step: { index: 11, id: 's12-click-confirm' },
			interventionRequestId: request.id,
		});
		expect(run.entries.some((entry) => entry.kind === 'action' && entry.stepId === 's12-click-confirm')).toBe(false);
		expectNoSecrets(run, ['Beach fund']);
	});

	it('attended app_error: escalates at s06, the operator fixes it on the same browser, resumes; success (AC11)', async () => {
		await bank.setFault('app_error', { mode: 'once', route: '/member/detail' });
		const started = await startReplay({
			bank,
			root,
			artifact: lookup,
			params: { memberId: '12345' },
			attended: true,
			options: { checkpointTimeoutMs: 3000 },
		});
		const { session, client } = started;
		if (client === null) throw new Error('attended run without a control client');

		const request = await until(
			async () => (await client.interventions()).find((candidate) => candidate.kind === 'takeover'),
			'the takeover request',
		);
		// checkpoint_failed today; app_error once its detector exists (step 43). Both escalate.
		expect(['checkpoint_failed', 'app_error']).toContain(request.reason.code);
		expect(request).toMatchObject({ status: 'open', currentStep: { index: 5, id: 's06-click-search' } });
		expect(JSON.stringify(request)).not.toContain('12345');

		await client.claim(request.id, 'ops-1');
		expect(session.lease.state()).toBe('HUMAN');

		// The operator goes back to Member Search from the menu, re-enters the member and searches again: the fault
		// was `once`, so Member Inquiry shows. Real gestures, mediated by the recorder.
		const operator = new SimulatedOperator(session.browser);
		await operator.click({ text: 'Member Search', frame: nav });
		expect(await session.surface.check({ kind: 'text_present', text: 'Member #', frame: content }, {}, 10_000)).toEqual(
			{ kind: 'held' },
		);
		await operator.type(memberInput, '12345');
		await operator.click(searchButton);
		expect(
			await session.surface.check({ kind: 'text_present', text: 'Member Inquiry', frame: content }, {}, 10_000),
		).toEqual({ kind: 'held' });
		await until(() => (session.recordedHumanActions().length >= 3 ? true : undefined), 'three recorded actions');

		await client.resume('ops-1');
		const run = await started.done;
		expect(RunResultSchema.parse(run.result)).toMatchObject({
			kind: 'success',
			outputs: { savingsBalance: '1523.47', memberName: 'Jane Sample' },
		});
		expect(leasePath(run.session)).toBe('AGENT → PAUSED → HUMAN → RESUMING → AGENT');
		const human = run.entries.filter((entry) => entry.kind === 'human_action');
		expect(human.length).toBeGreaterThanOrEqual(3);
		expect(human.every((entry) => entry.actor === 'operator:ops-1')).toBe(true);
		// After the resume the s06 checkpoint was re-verified on the live screen before the automation continued.
		const resumedAt = run.entries.findIndex(
			(entry) => entry.kind === 'lease_change' && entry.transition.to === 'RESUMING',
		);
		const reverified = run.entries.findIndex(
			(entry, index) =>
				index > resumedAt &&
				entry.kind === 'checkpoint' &&
				entry.stepId === 's06-click-search' &&
				entry.result === 'held',
		);
		const extract = run.entries.findIndex(
			(entry) => entry.kind === 'action' && entry.stepId === 's07-extract-savings-balance',
		);
		expect(resumedAt).toBeGreaterThan(0);
		expect(reverified).toBeGreaterThan(resumedAt);
		expect(extract).toBeGreaterThan(reverified);
		expectNoSecrets(run);
	});
});
