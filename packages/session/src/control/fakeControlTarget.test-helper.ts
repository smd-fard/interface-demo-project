import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { EvidenceKind, EvidenceRef, InterventionRequest, OperatorActor } from '@idp/artifact-schema';
import type { StoredEvidence } from '@idp/evidence';
import { InterventionConflictError } from '../errors/InterventionConflictError.js';
import { InterventionNotFoundError } from '../errors/InterventionNotFoundError.js';
import { ControlLease } from '../lease/ControlLease.js';
import type { ControlTarget } from './ControlTarget.js';
import type { LeaseView } from './LeaseView.js';

export const REQUEST_ID = 'ir-20260929T101500-beef';

export const openRequest: InterventionRequest = {
	id: REQUEST_ID,
	runId: 'replay-20260929T101500-a1b2',
	runKind: 'replay',
	kind: 'takeover',
	reason: { code: 'target_unresolved', text: 'Search button not found' },
	subject: { kind: 'capability', id: 'member-lookup', version: '1.0.0' },
	currentStep: { index: 5, id: 's06-click-search', description: 'Click Search', risk: 'read' },
	state: { url: 'http://127.0.0.1:4010/', title: 'CoreOne', screenshotRef: null, a11ySnapshotRef: null },
	options: ['resumed', 'aborted'],
	status: 'open',
	createdAt: '2026-09-29T10:15:00.000Z',
};

const ref = (id: string, kind: EvidenceKind, refPath: string, localOnly = false): EvidenceRef => ({
	id,
	kind,
	path: refPath,
	sha256: '0'.repeat(64),
	redacted: true,
	localOnly,
});

/** A control target over a real ControlLease and one takeover request, with a few evidence files on disk. */
export async function fakeControlTarget(): Promise<ControlTarget & { readonly calls: string[] }> {
	const dir = await mkdtemp(path.join(tmpdir(), 'idp-control-'));
	const files: Record<string, StoredEvidence> = {};
	const add = async (evidence: EvidenceRef, content: string | Uint8Array) => {
		const absolutePath = path.join(dir, evidence.id);
		await writeFile(absolutePath, content);
		files[evidence.id] = { ref: evidence, absolutePath };
	};
	await add(ref('screenshot-0001', 'screenshot', 'screenshots/0001.png'), new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
	await add(ref('a11y-snapshot-0001', 'a11y_snapshot', 'snapshots/0001.json'), '{"role":"document"}\n');
	await add(ref('json-0001', 'json', `interventions/${REQUEST_ID}.json`), '{"id":"x"}\n');
	await add(ref('json-0002', 'json', 'prompts/turn-01.json'), '{"prompt":"x"}\n');
	await add(ref('trace-0001', 'trace', 'traces/0001-trace.zip', true), 'raw');

	const lease = new ControlLease({ automationActor: 'replay' });
	await lease.pause('target_unresolved before s06-click-search', REQUEST_ID);
	let request: InterventionRequest = openRequest;
	const calls: string[] = [];
	const view = (): LeaseView => ({ state: lease.state(), holder: lease.holder(), history: lease.history() });
	const find = (id: string, kind: InterventionRequest['kind']) => {
		if (id !== request.id) throw new InterventionNotFoundError(id);
		if (request.kind !== kind) throw new InterventionConflictError(id, 'operate on', 'wrong_kind');
		return request;
	};

	return {
		calls,
		lease: view,
		interventions: () => [request],
		intervention: (id) => (id === request.id ? request : undefined),
		evidence: (refId) => files[refId],
		claim: async (id: string, operator: OperatorActor) => {
			calls.push(`claim ${id} ${operator}`);
			find(id, 'takeover');
			await lease.cede(operator);
			request = { ...request, status: 'claimed' };
			return request;
		},
		approve: async (id: string, operator: OperatorActor) => {
			calls.push(`approve ${id} ${operator}`);
			return find(id, 'approval');
		},
		reject: async (id: string, operator: OperatorActor) => {
			calls.push(`reject ${id} ${operator}`);
			return find(id, 'approval');
		},
		resume: async (operator: OperatorActor) => {
			calls.push(`resume ${operator}`);
			await lease.resume(operator);
			request = {
				...request,
				status: 'resolved',
				resolution: { decision: 'resumed', by: operator, at: request.createdAt },
			};
			return view();
		},
		abort: async (operator: OperatorActor) => {
			calls.push(`abort ${operator}`);
			await lease.close(operator, 'operator aborted');
			return view();
		},
	};
}
