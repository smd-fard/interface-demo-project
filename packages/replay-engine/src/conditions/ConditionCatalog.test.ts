import { ConditionClassSchema, FAILURE_REASONS } from '@idp/artifact-schema';
import { describe, expect, it } from 'vitest';
import { CONDITION_CATALOG, CONDITION_CODES, shouldEscalate } from './ConditionCatalog.js';
import { failureReasonFor } from './failureReasonFor.js';

describe('CONDITION_CATALOG', () => {
	it('has an entry for every taxonomy code, keyed by its code', () => {
		expect([...CONDITION_CODES].sort()).toEqual(
			[
				'app_error',
				'checkpoint_failed',
				'failed_load',
				'known_dialog',
				'member_not_found',
				'permission_denied',
				'session_timeout',
				'slow_load',
				'target_unresolved',
				'unknown_dialog',
				'validation_rejected',
			].sort(),
		);
		for (const code of CONDITION_CODES) {
			const entry = CONDITION_CATALOG[code];
			expect(entry.code).toBe(code);
			expect(ConditionClassSchema.safeParse(entry.defaultClass).success).toBe(true);
			expect(entry.budget).toBeGreaterThanOrEqual(0);
		}
	});

	it('classes are consistent with responses: business → return, recoverable → bounded recovery, failure → fail', () => {
		for (const code of CONDITION_CODES) {
			const entry = CONDITION_CATALOG[code];
			const expected = { business_outcome: 'return_outcome', recoverable: 'recover', failure: 'fail' }[
				entry.defaultClass
			];
			expect(entry.response.kind, code).toBe(expected);
			if (entry.defaultClass === 'business_outcome') expect(entry.budget, code).toBe(0);
			if (entry.defaultClass === 'recoverable') expect(entry.budget, code).toBeGreaterThan(0);
			if (entry.response.kind === 'fail') expect(FAILURE_REASONS).toContain(entry.response.reason);
		}
	});

	it('a business outcome is never a failure reason (invariant 4)', () => {
		for (const code of ['member_not_found', 'validation_rejected', 'permission_denied'] as const) {
			expect(CONDITION_CATALOG[code].defaultClass).toBe('business_outcome');
			expect(FAILURE_REASONS as readonly string[]).not.toContain(code);
		}
	});

	it('hard failures that escalate: target_unresolved, checkpoint_failed, unknown_dialog, app_error only', () => {
		const escalating = FAILURE_REASONS.filter((reason) => shouldEscalate(reason));
		expect(escalating.sort()).toEqual(['app_error', 'checkpoint_failed', 'target_unresolved', 'unknown_dialog']);
	});

	it('failureReasonFor: a failure reason stays itself; a recoverable declared failure maps; app codes → app_error', () => {
		expect(failureReasonFor('app_error')).toBe('app_error');
		expect(failureReasonFor('unknown_dialog')).toBe('unknown_dialog');
		expect(failureReasonFor('session_timeout')).toBe('session_lost');
		expect(failureReasonFor('failed_load')).toBe('timeout');
		expect(failureReasonFor('core_outage')).toBe('app_error');
	});
});
