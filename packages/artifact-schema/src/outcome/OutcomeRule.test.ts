import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OutcomeRuleSchema } from './OutcomeRule.js';

const content = [{ kind: 'by_name', name: 'content' }];

const notFound = {
	code: 'member_not_found',
	class: 'business_outcome',
	description: 'The search found no member with that number.',
	signature: { kind: 'text_present', text: 'No records match your search criteria', frame: content },
	scope: ['s06-click-search'],
	message: {
		description: 'Red message text under the search form',
		frame: content,
		ladder: [
			{
				kind: 'text',
				text: 'No records match your search criteria',
				match: 'contains',
				rationale: 'The fixed wording of the not-found message.',
			},
		],
	},
};

const knownDialog = {
	code: 'known_dialog',
	class: 'recoverable',
	description: 'Maintenance notice shown when member detail loads.',
	signature: { kind: 'dialog_text', text: 'Scheduled maintenance' },
	scope: 'any_step',
	recovery: { kind: 'dismiss_dialog', action: 'accept' },
};

const recoverables = [
	knownDialog,
	{ ...knownDialog, code: 'session_timeout', recovery: { kind: 'reauth' } },
	{ ...knownDialog, code: 'failed_load', recovery: { kind: 'retry', max: 2, backoffMs: 500 } },
	{
		...knownDialog,
		code: 'notice_page',
		recovery: {
			kind: 'click_through',
			target: {
				description: 'Continue link on the notice interstitial',
				frame: content,
				ladder: [{ kind: 'role', role: 'link', name: 'Continue', rationale: 'Link caption is fixed.' }],
			},
		},
	},
];

const appError = {
	code: 'app_error',
	class: 'failure',
	description: 'The legacy server error page.',
	signature: {
		kind: 'any_of',
		signatures: [
			{ kind: 'title_matches', title: 'Server Error' },
			{ kind: 'text_present', text: 'Runtime Error' },
		],
	},
	scope: 'any_step',
};

describe('OutcomeRuleSchema', () => {
	it.each([notFound, appError, ...recoverables])('accepts $code', (rule) => {
		expect(OutcomeRuleSchema.parse(rule)).toEqual(rule);
	});

	it('rejects a recovery on a business outcome (a business outcome is returned, never recovered)', () => {
		const result = OutcomeRuleSchema.safeParse({ ...notFound, recovery: { kind: 'retry', max: 1, backoffMs: 0 } });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['recovery']);
	});

	it('rejects a recovery on a failure', () => {
		expect(OutcomeRuleSchema.safeParse({ ...appError, recovery: { kind: 'reauth' } }).success).toBe(false);
	});

	it('rejects a recoverable rule without a recovery', () => {
		const rule: Record<string, unknown> = { ...knownDialog };
		delete rule.recovery;
		const result = OutcomeRuleSchema.safeParse(rule);
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['recovery']);
	});

	it('rejects an unbounded retry, an unknown recovery kind and an unknown class', () => {
		expect(
			OutcomeRuleSchema.safeParse({ ...knownDialog, recovery: { kind: 'retry', max: 0, backoffMs: 0 } }).success,
		).toBe(false);
		expect(OutcomeRuleSchema.safeParse({ ...knownDialog, recovery: { kind: 'ask_llm' } }).success).toBe(false);
		expect(OutcomeRuleSchema.safeParse({ ...notFound, class: 'warning' }).success).toBe(false);
	});

	it('rejects an empty scope list, a bad step id and a non-snake code', () => {
		expect(OutcomeRuleSchema.safeParse({ ...notFound, scope: [] }).success).toBe(false);
		expect(OutcomeRuleSchema.safeParse({ ...notFound, scope: ['click-search'] }).success).toBe(false);
		expect(OutcomeRuleSchema.safeParse({ ...notFound, code: 'MemberNotFound' }).success).toBe(false);
	});

	it('rejects an unknown extra key (strict)', () => {
		expect(OutcomeRuleSchema.safeParse({ ...notFound, severity: 'high' }).success).toBe(false);
	});

	it('exports to JSON Schema', () => {
		expect(() => z.toJSONSchema(OutcomeRuleSchema)).not.toThrow();
	});
});
