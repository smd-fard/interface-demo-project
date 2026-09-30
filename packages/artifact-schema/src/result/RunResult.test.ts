import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FAILURE_REASONS, FailureReasonSchema } from './FailureReason.js';
import { RunResultSchema } from './RunResult.js';
import { RUN_RESULT_KINDS } from './RunResultKind.js';

const artifact = { id: 'member-lookup', version: '1.0.0', contentHash: `sha256:${'0'.repeat(64)}` };
const evidenceRef = {
	id: 'screenshot-0007',
	kind: 'screenshot',
	path: 'screenshots/0007-s06-click-search.png',
	sha256: 'b'.repeat(64),
	redacted: true,
	localOnly: false,
};

const success = {
	kind: 'success',
	runId: 'replay-20260929T101500-a1b2',
	artifact,
	outputs: { savingsBalance: '1523.47', memberName: '[REDACTED]', accounts: 2, active: true },
	durationMs: 4210,
	drift: [{ stepId: 's06-click-search', rungIndex: 1, rungKind: 'text' }],
	recoveries: 1,
};

const businessOutcome = {
	kind: 'business_outcome',
	runId: 'replay-20260929T101500-a1b2',
	artifact,
	code: 'member_not_found',
	message: 'No records match your search criteria',
	stepId: 's06-click-search',
};

const failure = {
	kind: 'failure',
	runId: 'replay-20260929T101500-a1b2',
	artifact,
	reason: 'checkpoint_failed',
	step: { index: 5, id: 's06-click-search' },
	expected: 'text "Member Inquiry" present in frame content',
	observed: 'title "Server Error"; text "Runtime Error"',
	evidence: [evidenceRef],
	interventionRequestId: 'ir-20260929T101530-beef',
};

describe('RunResultSchema', () => {
	it.each([success, businessOutcome, failure])('accepts a $kind result', (result) => {
		expect(RunResultSchema.parse(result)).toEqual(result);
	});

	it('accepts a failure with no artifact (it was invalid) and no step', () => {
		const result = { ...failure, artifact: null, reason: 'artifact_invalid', step: null, evidence: [] };
		const withoutRequest: Record<string, unknown> = { ...result };
		delete withoutRequest.interventionRequestId;
		expect(RunResultSchema.safeParse(withoutRequest).success).toBe(true);
	});

	it('requires an artifact on success and business_outcome', () => {
		expect(RunResultSchema.safeParse({ ...success, artifact: null }).success).toBe(false);
		expect(RunResultSchema.safeParse({ ...businessOutcome, artifact: null }).success).toBe(false);
	});

	it('rejects an unknown kind — a recoverable condition is never a result (invariant 4)', () => {
		const result = RunResultSchema.safeParse({ ...businessOutcome, kind: 'recoverable' });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['kind']);
	});

	it('rejects a missing field', () => {
		const missing: Record<string, unknown> = { ...success };
		delete missing.durationMs;
		const result = RunResultSchema.safeParse(missing);
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['durationMs']);
	});

	it('rejects an unknown key such as a raw secret', () => {
		const result = RunResultSchema.safeParse({ ...failure, password: 'hunter2' });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
	});

	it('rejects an unredacted evidence ref', () => {
		const result = RunResultSchema.safeParse({ ...failure, evidence: [{ ...evidenceRef, redacted: false }] });
		expect(result.success).toBe(false);
	});

	it('rejects drift at rung 0 (that is no drift) and an unknown rung kind', () => {
		expect(RunResultSchema.safeParse({ ...success, drift: [{ ...success.drift[0], rungIndex: 0 }] }).success).toBe(
			false,
		);
		expect(RunResultSchema.safeParse({ ...success, drift: [{ ...success.drift[0], rungKind: 'css' }] }).success).toBe(
			false,
		);
	});

	it('rejects bad output names, non-scalar outputs, a bad outcome code and a discovery run id on replay fields', () => {
		expect(RunResultSchema.safeParse({ ...success, outputs: { 'Savings Balance': '1.00' } }).success).toBe(false);
		expect(RunResultSchema.safeParse({ ...success, outputs: { savingsBalance: { raw: '1.00' } } }).success).toBe(false);
		expect(RunResultSchema.safeParse({ ...businessOutcome, code: 'Member Not Found' }).success).toBe(false);
		expect(RunResultSchema.safeParse({ ...success, runId: 'run-1' }).success).toBe(false);
	});

	it('rejects a negative duration or recovery count', () => {
		expect(RunResultSchema.safeParse({ ...success, durationMs: -1 }).success).toBe(false);
		expect(RunResultSchema.safeParse({ ...success, recoveries: -1 }).success).toBe(false);
	});

	it('exports to JSON Schema', () => {
		expect(() => z.toJSONSchema(RunResultSchema)).not.toThrow();
	});
});

describe('FailureReasonSchema', () => {
	it('is exactly the planned enum', () => {
		expect(FAILURE_REASONS).toEqual([
			'invalid_params',
			'artifact_invalid',
			'policy_denied',
			'approval_required',
			'approval_rejected',
			'target_unresolved',
			'checkpoint_failed',
			'unknown_dialog',
			'app_error',
			'recovery_exhausted',
			'output_invalid',
			'session_lost',
			'human_aborted',
			'timeout',
		]);
	});

	it.each(['recoverable', 'session_timeout', 'known_dialog', 'member_not_found'])(
		'has no member for the recoverable condition or business outcome %s',
		(reason) => {
			expect(FailureReasonSchema.safeParse(reason).success).toBe(false);
		},
	);

	it('result kinds are exactly success | business_outcome | failure', () => {
		expect(RUN_RESULT_KINDS).toEqual(['success', 'business_outcome', 'failure']);
		expect(RunResultSchema.options.map((option) => option.shape.kind.value)).toEqual([...RUN_RESULT_KINDS]);
	});
});
