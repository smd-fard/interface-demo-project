import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CapabilityArtifactSchema, type TargetRef } from '@idp/artifact-schema';
import { RunLog } from '@idp/evidence';
import { createRedactor, resolvePolicy } from '@idp/policy';
import { ApprovalRequiredError, type ActionTarget, type Surface } from '@idp/surface';
import { launchMockBank, mockBankPolicyConfig, SimulatedOperator, type MockBank } from '@idp/surface/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	ControlClient,
	LeaseNotHeldError,
	openLiveSession,
	type InterventionSubject,
	type LiveSession,
} from '../../src/index.js';

const content = [{ kind: 'by_name' as const, name: 'content' }];
const rationale = 'functional test';

async function fixtureTargets(name: string): Promise<(id: string) => TargetRef> {
	const fixture = CapabilityArtifactSchema.parse(
		JSON.parse(await readFile(new URL(`../../../artifact-schema/fixtures/${name}`, import.meta.url), 'utf8')),
	);
	return (id) => {
		const step = fixture.steps.find((candidate) => candidate.id === id);
		if (step === undefined || !('target' in step) || step.target === undefined) throw new Error(id);
		return step.target;
	};
}
const t = (target: TargetRef): ActionTarget => ({ kind: 'target', target });
const textIn = (text: string) => ({ kind: 'text_present' as const, text, frame: content });

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

async function until<T>(probe: () => Promise<T | undefined> | T | undefined, what: string, timeoutMs = 10_000) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = await probe();
		if (value !== undefined) return value;
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

describe('session: live handoff on the same browser (AC10, AC11)', () => {
	let bank: MockBank;
	let root: string;
	let lookup: (id: string) => TargetRef;
	let subAccount: (id: string) => TargetRef;
	const sessions: LiveSession[] = [];

	beforeAll(async () => {
		bank = await launchMockBank({ tenant: 'a' });
		root = await mkdtemp(path.join(tmpdir(), 'idp-handoff-'));
		lookup = await fixtureTargets('member-lookup.artifact.json');
		subAccount = await fixtureTargets('open-sub-account.artifact.json');
	});
	afterEach(async () => {
		await Promise.all(sessions.splice(0).map((session) => session.close()));
		await bank.reset();
	});
	afterAll(async () => {
		await bank?.stop();
		if (root !== undefined) await rm(root, { recursive: true, force: true });
	});

	async function open(subject: InterventionSubject, attended = true): Promise<LiveSession> {
		const policy = resolvePolicy(mockBankPolicyConfig(bank.origin));
		const session = await openLiveSession({
			policy,
			redactor: createRedactor({
				config: policy,
				sensitiveValues: ['synthetic-pass-01', { value: '12345', paramName: 'memberId' }],
			}),
			runsRoot: root,
			runKind: 'replay',
			origin: bank.origin,
			headless: true,
			attended,
			controlPort: 0,
			subject,
		});
		sessions.push(session);
		return session;
	}

	async function signOn(surface: Surface): Promise<void> {
		const actor = 'replay' as const;
		await surface.act({ kind: 'navigate', actor, route: '/' });
		await surface.act({
			kind: 'fill',
			actor,
			target: t(lookup('s02-fill-user-id')),
			value: 'teller01',
			sensitive: true,
		});
		await surface.act({
			kind: 'fill',
			actor,
			target: t(lookup('s03-fill-password')),
			value: 'synthetic-pass-01',
			sensitive: true,
		});
		await surface.act({ kind: 'click', actor, target: t(lookup('s04-click-sign-on')) });
		expect(await surface.check(textIn('Member Search'), {}, 10_000)).toEqual({ kind: 'held' });
	}

	it('takeover: the operator claims, fills and searches (recorded), resumes; the automation reacquires', async () => {
		const session = await open({ kind: 'capability', id: 'member-lookup', version: '1.0.0' });
		expect(session.controlUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		const client = new ControlClient({ url: session.controlUrl ?? '', token: session.controlToken ?? '' });

		// 1. The automation holds the lease and signs on through the leased, guarded surface.
		expect(session.lease.holder()).toBe('agent');
		await signOn(session.surface);

		// 2. It escalates (in the background: it waits for the operator).
		const escalation = session.escalate(
			{ code: 'target_unresolved', text: 'The Member # field for 12345 could not be resolved' },
			{ index: 4, id: 's05-fill-member-id', description: 'Fill the Member # with 12345', risk: 'reversible' },
		);
		const request = await until(async () => (await client.interventions())[0], 'the intervention request');
		expect(request).toMatchObject({ kind: 'takeover', status: 'open', options: ['resumed', 'aborted'] });
		expect(JSON.stringify(request)).not.toContain('12345');
		expect(session.lease.state()).toBe('PAUSED');
		const screenshot = await client.evidence(request.state.screenshotRef?.id ?? '');
		expect(screenshot.contentType).toBe('image/png');
		expect(screenshot.bytes.length).toBeGreaterThan(100);

		// 3. The operator claims through the control API.
		expect(await client.claim(request.id, 'ops-1')).toMatchObject({ status: 'claimed' });
		expect(session.lease.state()).toBe('HUMAN');
		expect(session.lease.holder()).toBe('human');

		// FR20: the automation cannot act while the human holds the lease.
		await expect(
			session.surface.act({ kind: 'click', actor: 'replay', target: t(searchButton) }),
		).rejects.toBeInstanceOf(LeaseNotHeldError);

		// 4. The operator fills the member id and clicks Search with real gestures; the recorder mediates them.
		const operator = new SimulatedOperator(session.browser);
		await operator.type(memberInput, '12345');
		await operator.click(searchButton);
		await until(() => (session.recordedHumanActions().length >= 2 ? true : undefined), 'two recorded actions');

		// 5. The operator resumes; escalate returns the recorded actions and the lease is RESUMING.
		expect(await client.resume('ops-1')).toMatchObject({ state: 'RESUMING' });
		const outcome = await escalation;
		expect(outcome.kind).toBe('resumed');
		if (outcome.kind !== 'resumed') throw new Error('unreachable');
		expect(outcome.requestId).toBe(request.id);
		expect(outcome.humanActions.map((action) => [action.kind, action.verdict, action.refused])).toEqual([
			['fill', 'allow', false],
			['click', 'allow', false],
		]);
		expect(outcome.humanActions[0]?.operator).toBe('operator:ops-1');
		expect(outcome.humanActions[1]?.fingerprint).toMatchObject({
			role: 'button',
			name: 'Search',
			framePath: ['content'],
		});
		expect(outcome.humanActions[0]?.fingerprint).toMatchObject({ labelCellText: 'Member #', tag: 'input' });

		// The caller re-verifies its checkpoint on the live screen, then reacquires.
		expect(session.lease.state()).toBe('RESUMING');
		expect(await session.surface.check(textIn('Member Inquiry'), {}, 10_000)).toEqual({ kind: 'held' });
		await session.lease.reacquire();
		expect(session.lease.history().map((transition) => transition.to)).toEqual([
			'PAUSED',
			'HUMAN',
			'RESUMING',
			'AGENT',
		]);
		expect(['AGENT', ...session.lease.history().map((transition) => transition.to)].join(' → ')).toBe(
			'AGENT → PAUSED → HUMAN → RESUMING → AGENT',
		);
		// The automation acts again.
		await session.surface.act({ kind: 'click', actor: 'replay', target: t(subAccount('s07-click-open-sub-account')) });

		const logPath = session.runLog.path;
		await session.close();
		const text = await readFile(logPath, 'utf8');
		expect(text).not.toContain('12345');
		expect(text).not.toContain('synthetic-pass-01');
		const entries = await RunLog.read(logPath);
		const leaseChanges = entries.filter((entry) => entry.kind === 'lease_change');
		expect(leaseChanges.map((entry) => (entry.kind === 'lease_change' ? entry.transition.to : ''))).toEqual([
			'PAUSED',
			'HUMAN',
			'RESUMING',
			'AGENT',
			'CLOSED',
		]);
		const human = entries.filter((entry) => entry.kind === 'human_action');
		expect(human).toHaveLength(2);
		expect(human.every((entry) => entry.actor === 'operator:ops-1')).toBe(true);
		expect(entries.some((entry) => entry.kind === 'policy_verdict' && entry.actor === 'operator:ops-1')).toBe(true);
		expect(
			entries.filter((entry) => entry.kind === 'intervention').map((e) => (e.kind === 'intervention' ? e.event : '')),
		).toEqual(['raised', 'claimed', 'resolved']);
		const manifest = JSON.parse(await readFile(path.join(session.runDir.path, 'manifest.json'), 'utf8')) as {
			endedAt: string | null;
			evidence: unknown[];
		};
		expect(manifest.endedAt).not.toBeNull();
		expect(manifest.evidence.length).toBeGreaterThanOrEqual(4);
	});

	it('approval: Confirm needs approval; the operator approves via the control API; the grant opens the sub-account', async () => {
		const session = await open({ kind: 'capability', id: 'open-sub-account', version: '1.0.0' });
		const client = new ControlClient({ url: session.controlUrl ?? '', token: session.controlToken ?? '' });
		const { surface } = session;
		const actor = 'replay' as const;
		await signOn(surface);
		await surface.act({ kind: 'fill', actor, target: t(memberInput), value: '12345', sensitive: true });
		await surface.act({ kind: 'click', actor, target: t(searchButton) });
		await surface.act({ kind: 'click', actor, target: t(subAccount('s07-click-open-sub-account')) });
		await surface.act({
			kind: 'select',
			actor,
			target: t(subAccount('s08-select-product')),
			option: 'Vacation Savings',
		});
		await surface.act({
			kind: 'fill',
			actor,
			target: t(subAccount('s09-fill-initial-deposit')),
			value: '25.00',
			sensitive: false,
		});
		await surface.act({
			kind: 'fill',
			actor,
			target: t(subAccount('s10-fill-nickname')),
			value: 'Beach fund',
			sensitive: true,
		});
		await surface.act({ kind: 'click', actor, target: t(subAccount('s11-click-continue')) });
		expect(await surface.check(textIn('Review Sub-Account'), {}, 10_000)).toEqual({ kind: 'held' });

		const confirm = {
			kind: 'click',
			actor,
			stepId: 's12-click-confirm',
			target: t(subAccount('s12-click-confirm')),
		} as const;
		await expect(surface.act(confirm)).rejects.toBeInstanceOf(ApprovalRequiredError);

		const approval = session.requestApproval({ index: 11, stepId: 's12-click-confirm', description: 'Click Confirm' });
		const request = await until(async () => (await client.interventions())[0], 'the approval request');
		expect(request).toMatchObject({ kind: 'approval', currentStep: { id: 's12-click-confirm', risk: 'irreversible' } });
		expect(session.lease.state()).toBe('PAUSED');
		await expect(surface.act(confirm)).rejects.toBeInstanceOf(LeaseNotHeldError);

		await client.approve(request.id, 'ops-1');
		const outcome = await approval;
		expect(outcome.kind).toBe('granted');
		if (outcome.kind !== 'granted') throw new Error('unreachable');
		expect(session.lease.state()).toBe('AGENT');
		await surface.act({ ...confirm, approvalGrant: outcome.grant });
		expect(await surface.check(textIn('Sub-Account Opened'), {}, 10_000)).toEqual({ kind: 'held' });
		expect(session.lease.history().map((transition) => transition.to)).toEqual(['PAUSED', 'RESUMING', 'AGENT']);
		// No human acted during an approval.
		expect(session.recordedHumanActions()).toEqual([]);
	});

	it('unattended: escalate raises and persists the request and returns at once; no control server', async () => {
		const session = await open({ kind: 'capability', id: 'member-lookup', version: '1.0.0' }, false);
		expect(session.controlUrl).toBeNull();
		expect(session.controlToken).toBeNull();
		await signOn(session.surface);
		const outcome = await session.escalate(
			{ code: 'target_unresolved', text: 'stuck' },
			{ index: 4, description: 'Fill the Member #', risk: 'reversible' },
		);
		expect(outcome).toMatchObject({ kind: 'unattended' });
		expect(session.lease.state()).toBe('PAUSED');
		const ref = session.interventions.refOf(outcome.requestId);
		expect(ref?.path).toBe(`interventions/${outcome.requestId}.json`);
	});
});
