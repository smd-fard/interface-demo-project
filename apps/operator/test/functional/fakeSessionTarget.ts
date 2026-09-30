import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { EvidenceRef, InterventionRequest, OperatorActor } from '@idp/artifact-schema';
import { ControlLease, InterventionConflictError, InterventionNotFoundError, type ControlTarget } from '@idp/session';

type StoredEvidence = NonNullable<ReturnType<ControlTarget['evidence']>>;

/** Masked screenshot bytes (a PNG signature plus a few synthetic bytes). */
export const SCREENSHOT_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7, 7]);

export interface FakeSessionTarget extends ControlTarget {
	readonly calls: string[];
	readonly request: () => InterventionRequest;
	dispose(): Promise<void>;
}

const ref = (id: string, kind: EvidenceRef['kind'], refPath: string): EvidenceRef => ({
	id,
	kind,
	path: refPath,
	sha256: '0'.repeat(64),
	redacted: true,
	localOnly: false,
});

/**
 * A fake live session for the control server: a real `ControlLease` paused on one intervention request
 * (a takeover of a replay, or an approval in discovery), with a masked screenshot on disk. Synthetic data only.
 */
export async function fakeSessionTarget(kind: InterventionRequest['kind']): Promise<FakeSessionTarget> {
	const dir = await mkdtemp(path.join(tmpdir(), 'idp-operator-'));
	const screenshotPath = path.join(dir, 'screenshot-0001.png');
	await writeFile(screenshotPath, SCREENSHOT_BYTES);
	const files: Record<string, StoredEvidence> = {
		'screenshot-0001': {
			ref: ref('screenshot-0001', 'screenshot', 'screenshots/0001.png'),
			absolutePath: screenshotPath,
		},
	};

	let request: InterventionRequest =
		kind === 'takeover'
			? {
					id: 'ir-20260929T101500-beef',
					runId: 'replay-20260929T101500-a1b2',
					runKind: 'replay',
					kind: 'takeover',
					reason: { code: 'target_unresolved', text: 'Search button not found' },
					subject: { kind: 'capability', id: 'member-lookup', version: '1.0.0' },
					currentStep: { index: 5, id: 's06-click-search', description: 'Click Search', risk: 'read' },
					state: {
						url: 'http://127.0.0.1:4010/member?id=[REDACTED]',
						title: 'CoreOne',
						screenshotRef: files['screenshot-0001']?.ref ?? null,
						a11ySnapshotRef: null,
					},
					options: ['resumed', 'aborted'],
					status: 'open',
					createdAt: '2026-09-29T10:15:00.000Z',
				}
			: {
					id: 'ir-20260929T102000-cafe',
					runId: 'discovery-20260929T102000-c3d4',
					runKind: 'discovery',
					kind: 'approval',
					reason: { code: 'approval_required', text: 'Confirm opening a sub-account' },
					subject: { kind: 'goal', goal: 'Open a savings sub-account for member {{memberId}}' },
					currentStep: { index: 12, description: 'Click Confirm', risk: 'irreversible' },
					state: { url: 'http://127.0.0.1:4010/confirm', title: 'CoreOne', screenshotRef: null, a11ySnapshotRef: null },
					options: ['approve', 'reject', 'aborted'],
					status: 'open',
					createdAt: '2026-09-29T10:20:00.000Z',
				};

	const lease = new ControlLease({ automationActor: kind === 'takeover' ? 'replay' : 'agent' });
	await lease.pause(`${request.reason.code} before step ${request.currentStep.index}`, request.id);
	const calls: string[] = [];
	const view = () => ({ state: lease.state(), holder: lease.holder(), history: lease.history() });
	const find = (id: string, expected: InterventionRequest['kind']) => {
		if (id !== request.id) throw new InterventionNotFoundError(id);
		if (request.kind !== expected) throw new InterventionConflictError(id, 'operate on', 'wrong_kind');
		return request;
	};
	const resolve = (decision: 'approve' | 'reject' | 'resumed', by: OperatorActor) => {
		request = { ...request, status: 'resolved', resolution: { decision, by, at: '2026-09-29T10:30:00.000Z' } };
		return request;
	};

	return {
		calls,
		request: () => request,
		dispose: () => rm(dir, { recursive: true, force: true }),
		lease: view,
		interventions: () => [request],
		intervention: (id) => (id === request.id ? request : undefined),
		evidence: (refId) => files[refId],
		claim: async (id, operator) => {
			calls.push(`claim ${id} ${operator}`);
			find(id, 'takeover');
			await lease.cede(operator);
			request = { ...request, status: 'claimed' };
			return request;
		},
		approve: async (id, operator) => {
			calls.push(`approve ${id} ${operator}`);
			find(id, 'approval');
			await lease.approve(operator, request.id);
			return resolve('approve', operator);
		},
		reject: async (id, operator) => {
			calls.push(`reject ${id} ${operator}`);
			find(id, 'approval');
			await lease.reject(operator);
			return resolve('reject', operator);
		},
		resume: async (operator) => {
			calls.push(`resume ${operator}`);
			await lease.resume(operator);
			resolve('resumed', operator);
			return view();
		},
		abort: async (operator) => {
			calls.push(`abort ${operator}`);
			await lease.close(operator, 'operator aborted');
			return view();
		},
	};
}
