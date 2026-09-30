import { readFile } from 'node:fs/promises';
import { RunResultSchema, type OutputSpec } from '@idp/artifact-schema';
import { FULL_MASK } from '@idp/policy';
import { DialogPendingError, SurfaceClosedError } from '@idp/surface';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeReplaySession, type FakeReplaySessionFixture } from '../fakeReplaySession.test-helper.js';
import { ResultBuilder } from './ResultBuilder.js';
import { redactResultForSink } from './redactResultForSink.js';

const artifactRef = { id: 'member-lookup', version: '1.0.0', contentHash: `sha256:${'1'.repeat(64)}` };
const outputs: OutputSpec[] = [
	{ name: 'savingsBalance', description: 'balance', type: { kind: 'decimal', scale: 2 }, sensitive: true },
	{ name: 'accountCount', description: 'count', type: { kind: 'integer' }, sensitive: false },
];

describe('ResultBuilder', () => {
	let fixture: FakeReplaySessionFixture;
	afterEach(async () => {
		await fixture.cleanup();
	});

	function builder(): ResultBuilder {
		const { session, redactor, clock } = fixture;
		return new ResultBuilder({
			runId: session.runId,
			artifact: artifactRef,
			redactor,
			surface: session.surface,
			evidence: session.evidence,
			clock,
			startedAt: clock.now(),
		});
	}

	it('success: outputs, drift, recoveries and the duration from the clock', async () => {
		fixture = await fakeReplaySession();
		const results = builder();
		fixture.clock.advance(12_345);
		const result = results.success({
			outputs: { savingsBalance: '1523.47', accountCount: 2 },
			drift: [{ stepId: 's06-click-search', rungIndex: 2, rungKind: 'structural' }],
			recoveries: 0,
		});
		expect(RunResultSchema.parse(result)).toEqual({
			kind: 'success',
			runId: fixture.session.runId,
			artifact: artifactRef,
			outputs: { savingsBalance: '1523.47', accountCount: 2 },
			durationMs: 12_345,
			drift: [{ stepId: 's06-click-search', rungIndex: 2, rungKind: 'structural' }],
			recoveries: 0,
		});
	});

	it('business outcome: the message is redacted', async () => {
		fixture = await fakeReplaySession();
		fixture.redactor.addSensitiveValue({ value: '99999', paramName: 'memberId' });
		const result = builder().businessOutcome({
			code: 'member_not_found',
			message: 'No records match 99999',
			stepId: 's06-click-search',
		});
		expect(result).toMatchObject({ kind: 'business_outcome', code: 'member_not_found' });
		expect(JSON.stringify(result)).not.toContain('99999');
		expect(RunResultSchema.safeParse(result).success).toBe(true);
	});

	it('failure: captures a masked screenshot and a redacted snapshot and attaches their refs (AC13)', async () => {
		fixture = await fakeReplaySession();
		fixture.redactor.addSensitiveValue({ value: '12345', paramName: 'memberId' });
		const result = await builder().failure({
			reason: 'checkpoint_failed',
			step: { index: 5, id: 's06-click-search' },
			expected: 'text "Member Inquiry" for member 12345',
			observed: 'still on the search page with 12345',
		});
		expect(RunResultSchema.parse(result)).toMatchObject({
			kind: 'failure',
			reason: 'checkpoint_failed',
			step: { index: 5, id: 's06-click-search' },
			artifact: artifactRef,
		});
		if (result.kind !== 'failure') throw new Error('unreachable');
		expect(result.evidence.map((ref) => ref.kind)).toEqual(['screenshot', 'a11y_snapshot']);
		expect(fixture.evidence.list()).toHaveLength(2);
		expect(JSON.stringify(result)).not.toContain('12345');
		expect(fixture.calls).toContain('captureEvidence');
	});

	it('failure with a pending dialog: no screenshot (and no faked ref), the redacted blocked-page snapshot instead', async () => {
		fixture = await fakeReplaySession({ pendingDialog: { type: 'confirm', message: 'Retry member 12345?' } });
		fixture.redactor.addSensitiveValue({ value: '12345', paramName: 'memberId' });
		fixture.surface.captureEvidence = () => Promise.reject(new DialogPendingError('capture_evidence', 'confirm'));
		const result = await builder().failure({
			reason: 'unknown_dialog',
			step: { index: 5, id: 's06-click-search' },
			expected: 'no dialog',
			observed: 'a confirm dialog is pending',
		});
		if (result.kind !== 'failure') throw new Error('unreachable');
		expect(result.evidence.map((ref) => ref.kind)).toEqual(['a11y_snapshot']);
		expect(result.observed).toContain('screenshot not captured (DIALOG_PENDING');
		expect(result.observed).toContain('the a11y snapshot holds the frame structure and the dialog only');
		const stored = await readFile(fixture.runDir.resolve(result.evidence[0]?.path ?? ''), 'utf8');
		expect(stored).toContain('confirm');
		expect(stored).not.toContain('12345');
		expect(RunResultSchema.safeParse(result).success).toBe(true);
	});

	it('failure: evidence capture that fails otherwise does not crash the run; the reason is recorded', async () => {
		fixture = await fakeReplaySession();
		fixture.surface.captureEvidence = () => Promise.reject(new SurfaceClosedError());
		const result = await builder().failure({
			reason: 'session_lost',
			step: { index: 6, id: 's07-extract-savings-balance' },
			expected: 'a live session',
			observed: 'closed',
		});
		expect(result).toMatchObject({ kind: 'failure', evidence: [] });
		if (result.kind !== 'failure') throw new Error('unreachable');
		expect(result.observed).toContain('evidence not captured (SURFACE_CLOSED)');
	});

	it('failure before any surface call: no capture, artifact may be null', async () => {
		fixture = await fakeReplaySession();
		const results = builder();
		results.setArtifact(null);
		const result = await results.failure({
			reason: 'artifact_invalid',
			step: null,
			expected: 'a valid artifact',
			observed: 'contentHash mismatch',
			captureEvidence: false,
		});
		expect(result).toMatchObject({ kind: 'failure', artifact: null, evidence: [] });
		expect(fixture.calls).toEqual([]);
	});
});

describe('redactResultForSink', () => {
	it('masks sensitive outputs and free text but keeps structural numbers and hashes intact', async () => {
		const { createRedactor } = await import('@idp/policy');
		const redactor = createRedactor({ sensitiveValues: [{ value: '12345', paramName: 'memberId' }, '1523.47'] });
		const persisted = redactResultForSink(
			{
				kind: 'success',
				runId: 'replay-20260929T101500-0001',
				artifact: { ...artifactRef, contentHash: `sha256:12345${'0'.repeat(59)}` },
				outputs: { savingsBalance: '1523.47', accountCount: 2 },
				durationMs: 12_345,
				drift: [],
				recoveries: 0,
			},
			redactor,
			outputs,
		);
		expect(persisted).toMatchObject({
			outputs: { savingsBalance: FULL_MASK, accountCount: 2 },
			durationMs: 12_345,
			artifact: { contentHash: `sha256:12345${'0'.repeat(59)}` },
		});
		expect(RunResultSchema.safeParse(persisted).success).toBe(true);
	});
});
