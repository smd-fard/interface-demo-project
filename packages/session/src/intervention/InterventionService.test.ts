import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { InterventionRequestSchema, type RunId } from '@idp/artifact-schema';
import { EvidenceStore, RunDirectory, RunLog } from '@idp/evidence';
import { FakeClock, FakeRandom } from '@idp/evidence/testing';
import { createRedactor, resolvePolicy } from '@idp/policy';
import { ApprovalGrantRegistry, DialogPendingError, type EvidenceCapture } from '@idp/surface';
import { FakeSurface, fakeObservation, mockBankPolicyConfig } from '@idp/surface/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IllegalLeaseTransitionError } from '../errors/IllegalLeaseTransitionError.js';
import { InterventionConflictError } from '../errors/InterventionConflictError.js';
import { InterventionNotFoundError } from '../errors/InterventionNotFoundError.js';
import { InterventionTimeoutError } from '../errors/InterventionTimeoutError.js';
import { SessionValidationError } from '../errors/SessionValidationError.js';
import { ControlLease } from '../lease/ControlLease.js';
import { InterventionService, type RaiseInterventionInput } from './InterventionService.js';

const origin = 'http://127.0.0.1:4010';
const OPS = 'operator:ops-1';
const RAW = ['12345', 'Jane Sample'];

const pageUrl = `${origin}/member/detail?member=12345`;
const location = {
	url: pageUrl,
	title: 'Jane Sample — Member Inquiry',
	frames: [{ path: [], name: '', url: pageUrl, title: 'Jane Sample — Member Inquiry' }],
};
const tree = {
	role: 'document',
	name: '',
	framePath: [],
	children: [{ role: 'cell', name: 'Jane Sample', framePath: ['content'], children: [] }],
};

const takeover = (overrides: Partial<RaiseInterventionInput> = {}): RaiseInterventionInput => ({
	kind: 'takeover',
	reason: { code: 'target_unresolved', text: 'Could not find the balance of member 12345 (Jane Sample)' },
	subject: { kind: 'goal', goal: 'Look up member 12345 and report the balance of Jane Sample' },
	currentStep: { index: 3, description: 'Read the balance of Jane Sample', risk: 'read' },
	...overrides,
});

const approval = (overrides: Partial<RaiseInterventionInput> = {}): RaiseInterventionInput => ({
	kind: 'approval',
	reason: { code: 'approval_required', text: 'Confirm opens a sub-account for member 12345' },
	subject: { kind: 'goal', goal: 'Open a sub-account for member 12345' },
	currentStep: { index: 11, description: 'Click Confirm for Jane Sample', risk: 'irreversible' },
	grantBinding: { fingerprintKey: 'fp:abc' },
	...overrides,
});

class RefusingSurface extends FakeSurface {
	override captureEvidence(): Promise<EvidenceCapture> {
		return Promise.reject(new DialogPendingError('capture', 'confirm'));
	}
}

describe('InterventionService', () => {
	let root: string;
	let runLog: RunLog;
	let evidence: EvidenceStore;
	let lease: ControlLease;
	let grants: ApprovalGrantRegistry;
	let clock: FakeClock;
	const runId: RunId = 'discovery-20260929T101500-a1b2';

	beforeEach(async () => {
		root = await mkdtemp(path.join(tmpdir(), 'idp-session-'));
		const runDir = await RunDirectory.create(root, runId);
		const redactor = createRedactor({ config: resolvePolicy(mockBankPolicyConfig(origin)), sensitiveValues: [] });
		runLog = RunLog.create(runDir, redactor);
		evidence = new EvidenceStore(runDir);
		clock = new FakeClock();
		lease = new ControlLease({ automationActor: 'agent', clock });
		grants = new ApprovalGrantRegistry({ clock });
	});
	afterEach(async () => {
		await runLog.close();
		await rm(root, { recursive: true, force: true });
	});

	function service(surface = new FakeSurface({ location, observations: [fakeObservation(pageUrl, { tree })] })) {
		return new InterventionService({
			runId,
			runKind: 'discovery',
			surface,
			redactor: createRedactor({ config: resolvePolicy(mockBankPolicyConfig(origin)), sensitiveValues: [] }),
			evidence,
			runLog,
			lease,
			grants,
			clock,
			random: new FakeRandom(['beef', 'cafe']),
		});
	}

	async function persisted(refPath: string): Promise<string> {
		return readFile(path.join(root, runId, refPath), 'utf8');
	}

	it('raise: captures masked evidence, persists a redacted, schema-valid request, logs it and pauses the lease', async () => {
		const interventions = service();
		const request = await interventions.raise(takeover());

		expect(request).toMatchObject({
			id: 'ir-20260929T101500-beef',
			runId,
			runKind: 'discovery',
			kind: 'takeover',
			status: 'open',
			options: ['resumed', 'aborted'],
			createdAt: '2026-09-29T10:15:00.000Z',
			reason: { code: 'target_unresolved' },
			currentStep: { index: 3, risk: 'read' },
		});
		expect(InterventionRequestSchema.safeParse(request).success).toBe(true);
		expect(request.state.screenshotRef).toMatchObject({ kind: 'screenshot', localOnly: false });
		expect(request.state.a11ySnapshotRef).toMatchObject({ kind: 'a11y_snapshot', localOnly: false });
		expect(lease.state()).toBe('PAUSED');
		expect(lease.history()[0]).toMatchObject({ actor: 'agent', requestId: request.id });

		const refs = evidence.list();
		const doc = refs.find((ref) => ref.kind === 'json');
		expect(doc?.path).toBe(`interventions/${request.id}.json`);
		const text = await persisted(doc?.path ?? '');
		expect(JSON.parse(text)).toEqual(request);
		const snapshot = await persisted(request.state.a11ySnapshotRef?.path ?? '');
		for (const raw of RAW) {
			expect(text).not.toContain(raw);
			expect(snapshot).not.toContain(raw);
			expect(JSON.stringify(request)).not.toContain(raw);
		}
		expect(request.state.url).toContain('[•••45]');

		const entries = await runLog.entries();
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			kind: 'intervention',
			actor: 'agent',
			requestId: request.id,
			interventionKind: 'takeover',
			event: 'raised',
			requestRef: doc,
		});
	});

	it('raise refuses when the automation does not hold the lease; nothing is persisted', async () => {
		const interventions = service();
		await lease.pause('stuck');
		await expect(interventions.raise(takeover())).rejects.toBeInstanceOf(IllegalLeaseTransitionError);
		expect(evidence.list()).toHaveLength(0);
		expect(interventions.list()).toHaveLength(0);
	});

	it('raise refuses a subject that does not match the run kind (schema refinement)', async () => {
		const interventions = service();
		await expect(
			interventions.raise(takeover({ subject: { kind: 'capability', id: 'member-lookup', version: '1.0.0' } })),
		).rejects.toBeInstanceOf(SessionValidationError);
		expect(lease.state()).toBe('AGENT');
	});

	it('raise refuses an approval with nothing to bind the grant to', async () => {
		const interventions = service();
		await expect(interventions.raise(approval({ grantBinding: {} }))).rejects.toBeInstanceOf(SessionValidationError);
		expect(lease.state()).toBe('AGENT');
	});

	it('a failed capture leaves null evidence refs (the request is still raised)', async () => {
		const interventions = service(new RefusingSurface({ location }));
		const request = await interventions.raise(takeover());
		expect(request.state).toMatchObject({ screenshotRef: null, a11ySnapshotRef: null });
		expect(lease.state()).toBe('PAUSED');
	});

	it('takeover: claim cedes to the operator, resume resolves it; each status change is re-persisted', async () => {
		const interventions = service();
		const request = await interventions.raise(takeover());
		const resolution = interventions.awaitResolution(request.id);

		const claimed = await interventions.claim(request.id, OPS);
		expect(claimed.status).toBe('claimed');
		expect(lease.state()).toBe('HUMAN');
		expect(lease.operator()).toBe(OPS);

		clock.advance(5_000);
		const resumed = await interventions.resume(OPS);
		expect(resumed?.status).toBe('resolved');
		expect(lease.state()).toBe('RESUMING');
		await expect(resolution).resolves.toEqual({ decision: 'resumed', by: OPS, at: '2026-09-29T10:15:05.000Z' });
		expect(interventions.get(request.id)?.resolution?.decision).toBe('resumed');

		const docs = evidence.list().filter((ref) => ref.kind === 'json');
		expect(docs.map((ref) => ref.path)).toEqual([
			`interventions/${request.id}.json`,
			`interventions/${request.id}-v2.json`,
			`interventions/${request.id}-v3.json`,
		]);
		expect(JSON.parse(await persisted(docs[2]?.path ?? ''))).toMatchObject({ status: 'resolved' });
		expect((await runLog.entries()).map((entry) => (entry.kind === 'intervention' ? entry.event : entry.kind))).toEqual(
			['raised', 'claimed', 'resolved'],
		);

		// A second resume signal is idempotent: nothing left to resolve.
		expect(await interventions.resume(OPS)).toBeNull();
		expect(lease.state()).toBe('RESUMING');
	});

	it('approval: approve mints a single-use grant bound to the step and moves the lease to RESUMING', async () => {
		const interventions = service();
		const request = await interventions.raise(approval({ grantBinding: { stepId: 's12-click-confirm' } }));
		expect(request.options).toEqual(['approve', 'reject', 'aborted']);
		const resolution = interventions.awaitResolution(request.id);
		await interventions.approve(request.id, OPS);
		const resolved = await resolution;
		expect(resolved).toMatchObject({ decision: 'approve', by: OPS });
		expect(resolved.grant).toMatchObject({ requestId: request.id, stepId: 's12-click-confirm', grantedBy: OPS });
		expect(lease.state()).toBe('RESUMING');
		if (resolved.grant === undefined) throw new Error('no grant');
		expect(grants.consume(resolved.grant, { stepId: 's12-click-confirm' })).toEqual({ kind: 'accepted' });
		// The grant never reaches the persisted request.
		const last = evidence.list().at(-1);
		expect(await persisted(last?.path ?? '')).not.toContain('grantedBy');
	});

	it('approval: reject closes the lease and resolves without a grant', async () => {
		const interventions = service();
		const request = await interventions.raise(approval());
		await interventions.reject(request.id, OPS);
		const resolved = await interventions.awaitResolution(request.id);
		expect(resolved).toEqual({ decision: 'reject', by: OPS, at: '2026-09-29T10:15:00.000Z' });
		expect(lease.state()).toBe('CLOSED');
	});

	it('refuses the wrong operation for a request kind or status with InterventionConflictError', async () => {
		const interventions = service();
		const ask = await interventions.raise(approval());
		await expect(interventions.claim(ask.id, OPS)).rejects.toBeInstanceOf(InterventionConflictError);
		await interventions.approve(ask.id, OPS);
		await expect(interventions.approve(ask.id, OPS)).rejects.toBeInstanceOf(InterventionConflictError);
		await lease.reacquire();

		const stuck = await interventions.raise(takeover());
		await expect(interventions.approve(stuck.id, OPS)).rejects.toBeInstanceOf(InterventionConflictError);
		await expect(interventions.reject(stuck.id, OPS)).rejects.toBeInstanceOf(InterventionConflictError);
		await interventions.claim(stuck.id, OPS);
		await expect(interventions.claim(stuck.id, OPS)).rejects.toBeInstanceOf(InterventionConflictError);
	});

	it('an unknown id is InterventionNotFoundError', async () => {
		const interventions = service();
		await expect(interventions.claim('ir-20260929T101500-dead', OPS)).rejects.toBeInstanceOf(InterventionNotFoundError);
		await expect(interventions.awaitResolution('ir-20260929T101500-dead')).rejects.toBeInstanceOf(
			InterventionNotFoundError,
		);
		expect(interventions.get('ir-20260929T101500-dead')).toBeUndefined();
	});

	it('resume while no operator holds the lease is an illegal transition', async () => {
		const interventions = service();
		await interventions.raise(takeover());
		await expect(interventions.resume(OPS)).rejects.toBeInstanceOf(IllegalLeaseTransitionError);
	});

	it('awaitResolution rejects with InterventionTimeoutError when nobody answers in time', async () => {
		const interventions = service();
		const request = await interventions.raise(takeover());
		const error = await interventions.awaitResolution(request.id, { timeoutMs: 20 }).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(InterventionTimeoutError);
		expect(error).toMatchObject({ code: 'INTERVENTION_TIMEOUT', requestId: request.id });
		expect(interventions.get(request.id)?.status).toBe('open');
	});

	it('abort closes the lease and resolves every unresolved request as aborted', async () => {
		const interventions = service();
		const request = await interventions.raise(takeover());
		const resolution = interventions.awaitResolution(request.id);
		await interventions.claim(request.id, OPS);
		await interventions.abort(OPS);
		await expect(resolution).resolves.toMatchObject({ decision: 'aborted', by: OPS });
		expect(lease.state()).toBe('CLOSED');
		expect(interventions.list().map((r) => r.status)).toEqual(['resolved']);
	});

	it('list() returns the requests in raise order', async () => {
		const interventions = service();
		const first = await interventions.raise(takeover());
		await interventions.claim(first.id, OPS);
		await interventions.resume(OPS);
		await lease.reacquire();
		const second = await interventions.raise(approval());
		expect(interventions.list().map((r) => r.id)).toEqual([first.id, second.id]);
		expect(second.id).toBe('ir-20260929T101500-cafe');
	});
});
