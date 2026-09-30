import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { InterventionRequestSchema } from './InterventionRequest.js';

const shot = {
	id: 'screenshot-0012',
	kind: 'screenshot',
	path: 'screenshots/0012-s12-click-confirm.png',
	sha256: 'c'.repeat(64),
	redacted: true,
	localOnly: false,
};
const snapshot = { ...shot, id: 'a11y-0012', kind: 'a11y_snapshot', path: 'snapshots/0012.json' };

const open = {
	id: 'ir-20260929T101530-beef',
	runId: 'replay-20260929T101500-a1b2',
	runKind: 'replay',
	kind: 'approval',
	reason: { code: 'approval_required', text: 'Irreversible step "Click Confirm" needs operator approval.' },
	subject: { kind: 'capability', id: 'open-sub-account', version: '1.0.0' },
	currentStep: { index: 11, id: 's12-click-confirm', description: 'Click Confirm', risk: 'irreversible' },
	state: {
		url: 'http://127.0.0.1:4010/subaccount/confirm',
		title: 'CoreOne - Confirm Sub-Account',
		screenshotRef: shot,
		a11ySnapshotRef: snapshot,
	},
	options: ['approve', 'reject'],
	status: 'open',
	createdAt: '2026-09-29T10:15:30.000Z',
};

const resolved = {
	...open,
	status: 'resolved',
	resolution: { decision: 'approve', by: 'operator:ops-1', at: '2026-09-29T10:16:02.000Z' },
};

const takeover = {
	...open,
	id: 'ir-20260929T090000-0001',
	runId: 'discovery-20260929T085900-c0de',
	runKind: 'discovery',
	kind: 'takeover',
	reason: { code: 'target_unresolved', text: 'The agent could not find the Search button.' },
	subject: { kind: 'goal', goal: 'Look up member {{memberId}} and return the savings balance.' },
	currentStep: { index: 4, description: 'Find the member search form', risk: 'read' },
	state: { ...open.state, screenshotRef: null, a11ySnapshotRef: null },
	options: ['resumed', 'aborted'],
	status: 'claimed',
};

describe('InterventionRequestSchema', () => {
	it.each([
		['an open approval', open],
		['a resolved approval', resolved],
		['a claimed discovery takeover without a step id or evidence', takeover],
	])('accepts %s', (_name, request) => {
		expect(InterventionRequestSchema.parse(request)).toEqual(request);
	});

	it('rejects a missing field', () => {
		const missing: Record<string, unknown> = { ...open };
		delete missing.createdAt;
		const result = InterventionRequestSchema.safeParse(missing);
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['createdAt']);
	});

	it('rejects an unknown kind and an unknown subject kind', () => {
		expect(InterventionRequestSchema.safeParse({ ...open, kind: 'escalation' }).success).toBe(false);
		expect(InterventionRequestSchema.safeParse({ ...open, subject: { kind: 'url', url: '/x' } }).success).toBe(false);
	});

	it('rejects an unknown key such as a raw secret, at any level', () => {
		expect(InterventionRequestSchema.safeParse({ ...open, password: 'hunter2' }).success).toBe(false);
		const state = { ...open.state, memberNumber: '12345' };
		expect(InterventionRequestSchema.safeParse({ ...open, state }).success).toBe(false);
	});

	it('rejects an unredacted evidence ref', () => {
		const state = { ...open.state, screenshotRef: { ...shot, redacted: false } };
		expect(InterventionRequestSchema.safeParse({ ...open, state }).success).toBe(false);
	});

	it('requires a resolution exactly when resolved', () => {
		const noResolution = InterventionRequestSchema.safeParse({ ...open, status: 'resolved' });
		expect(noResolution.success).toBe(false);
		expect(noResolution.error?.issues[0]?.path).toEqual(['resolution']);
		const early = InterventionRequestSchema.safeParse({ ...resolved, status: 'open' });
		expect(early.success).toBe(false);
		expect(early.error?.issues[0]?.path).toEqual(['resolution']);
	});

	it('requires the resolution decision to be one of the offered options', () => {
		const result = InterventionRequestSchema.safeParse({
			...resolved,
			resolution: { ...resolved.resolution, decision: 'resumed' },
		});
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['resolution', 'decision']);
	});

	it('requires the resolver to be an operator', () => {
		const result = InterventionRequestSchema.safeParse({
			...resolved,
			resolution: { ...resolved.resolution, by: 'agent' },
		});
		expect(result.success).toBe(false);
	});

	it('rejects empty or duplicate options', () => {
		expect(InterventionRequestSchema.safeParse({ ...open, options: [] }).success).toBe(false);
		const dup = InterventionRequestSchema.safeParse({ ...open, options: ['approve', 'approve'] });
		expect(dup.success).toBe(false);
		expect(dup.error?.issues[0]?.path).toEqual(['options', 1]);
	});

	it('keeps runKind, runId and subject consistent', () => {
		const kindMismatch = InterventionRequestSchema.safeParse({ ...open, runKind: 'discovery' });
		expect(kindMismatch.success).toBe(false);
		expect(kindMismatch.error?.issues[0]?.path).toEqual(['runKind']);
		const goalOnReplay = InterventionRequestSchema.safeParse({ ...open, subject: takeover.subject });
		expect(goalOnReplay.success).toBe(false);
		expect(goalOnReplay.error?.issues[0]?.path).toEqual(['subject', 'kind']);
	});

	it('rejects a bad id and a bad reason code', () => {
		expect(InterventionRequestSchema.safeParse({ ...open, id: 'ir-1' }).success).toBe(false);
		expect(
			InterventionRequestSchema.safeParse({ ...open, reason: { ...open.reason, code: 'Approval Required' } }).success,
		).toBe(false);
	});

	it('exports to JSON Schema', () => {
		expect(() => z.toJSONSchema(InterventionRequestSchema)).not.toThrow();
	});
});
