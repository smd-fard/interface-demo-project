import type { EvidenceRef, InterventionRequest } from '@idp/artifact-schema';
import type { LeaseView } from '@idp/session';

/** A sentinel standing in for the session's bearer token: it must never reach the browser. */
export const TOKEN = 'c0ffee'.repeat(10) + 'abcd';

export const TAKEOVER_ID = 'ir-20260929T101500-beef';
export const APPROVAL_ID = 'ir-20260929T102000-cafe';

const ref = (id: string, kind: EvidenceRef['kind'], path: string): EvidenceRef => ({
	id,
	kind,
	path,
	sha256: '0'.repeat(64),
	redacted: true,
	localOnly: false,
});

/** A takeover request as the session serves it: every free-text value is already masked. */
export const takeoverRequest: InterventionRequest = {
	id: TAKEOVER_ID,
	runId: 'replay-20260929T101500-a1b2',
	runKind: 'replay',
	kind: 'takeover',
	reason: { code: 'target_unresolved', text: 'Search button not found for member [REDACTED:memberId]' },
	subject: { kind: 'capability', id: 'member-lookup', version: '1.0.0' },
	currentStep: { index: 5, id: 's06-click-search', description: 'Click Search', risk: 'read' },
	state: {
		url: 'http://127.0.0.1:4010/member?id=[REDACTED]',
		title: 'CoreOne - Member [REDACTED]',
		screenshotRef: ref('screenshot-0001', 'screenshot', 'screenshots/0001.png'),
		a11ySnapshotRef: ref('a11y-snapshot-0001', 'a11y_snapshot', 'snapshots/0001.json'),
	},
	options: ['resumed', 'aborted'],
	status: 'open',
	createdAt: '2026-09-29T10:15:00.000Z',
};

/** An approval request for an irreversible step, from a discovery run (a goal subject). */
export const approvalRequest: InterventionRequest = {
	id: APPROVAL_ID,
	runId: 'discovery-20260929T102000-c3d4',
	runKind: 'discovery',
	kind: 'approval',
	reason: { code: 'approval_required', text: 'Confirm opening a sub-account' },
	subject: { kind: 'goal', goal: 'Open a savings sub-account for member {{memberId}}' },
	currentStep: { index: 12, description: 'Click Confirm', risk: 'irreversible' },
	state: {
		url: 'http://127.0.0.1:4010/confirm',
		title: 'CoreOne - Confirm',
		screenshotRef: null,
		a11ySnapshotRef: null,
	},
	options: ['approve', 'reject', 'aborted'],
	status: 'open',
	createdAt: '2026-09-29T10:20:00.000Z',
};

export const pausedLease: LeaseView = {
	state: 'PAUSED',
	holder: 'none',
	history: [
		{
			from: 'AGENT',
			to: 'PAUSED',
			actor: 'replay',
			reason: 'target_unresolved before s06-click-search',
			at: '2026-09-29T10:15:00.000Z',
			requestId: TAKEOVER_ID,
		},
	],
};

export const humanLease: LeaseView = { state: 'HUMAN', holder: 'human', history: [] };
