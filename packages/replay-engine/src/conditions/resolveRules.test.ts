import type { OutcomeRule } from '@idp/artifact-schema';
import { describe, expect, it } from 'vitest';
import { loadFixture } from '../fakeReplaySession.test-helper.js';
import { resolveCondition, resolveRules } from './resolveRules.js';

const notFoundProfile: OutcomeRule = {
	code: 'member_not_found',
	class: 'business_outcome',
	description: 'profile default',
	signature: { kind: 'text_present', text: 'No records match your search criteria' },
	scope: 'any_step',
};
const notFoundArtifact: OutcomeRule = { ...notFoundProfile, description: 'artifact rule', scope: ['s06-click-search'] };
const deniedProfile: OutcomeRule = {
	code: 'permission_denied',
	class: 'business_outcome',
	description: 'profile default',
	signature: { kind: 'text_present', text: 'SEC-403' },
	scope: 'any_step',
};
const appErrorProfile: OutcomeRule = {
	code: 'app_error',
	class: 'failure',
	description: 'profile default',
	signature: { kind: 'title_matches', title: 'Server Error' },
	scope: 'any_step',
};

describe('resolveRules (artifact rule → app profile → catalog default)', () => {
	it('an artifact rule overrides the profile rule with the same code, and its scope limits where it applies', () => {
		const input = { artifactRules: [notFoundArtifact], profileRules: [notFoundProfile, deniedProfile] };
		const atSearch = resolveRules({ ...input, stepId: 's06-click-search' });
		expect(atSearch.map((rule) => [rule.code, rule.source, rule.description])).toEqual([
			['member_not_found', 'artifact', 'artifact rule'],
			['permission_denied', 'profile', 'profile default'],
		]);
		// Elsewhere the artifact's scoped rule does not apply, and the profile's rule for that code stays overridden.
		const elsewhere = resolveRules({ ...input, stepId: 's05-fill-member-id' });
		expect(elsewhere.map((rule) => rule.code)).toEqual(['permission_denied']);
	});

	it('the success condition (stepId null) sees only any_step rules', () => {
		const rules = resolveRules({
			artifactRules: [notFoundArtifact],
			profileRules: [deniedProfile],
			stepId: null,
		});
		expect(rules.map((rule) => rule.code)).toEqual(['permission_denied']);
	});

	it('the member-lookup fixture: its three business outcomes apply at the Search step', () => {
		const fixture = loadFixture('member-lookup');
		const rules = resolveRules({ artifactRules: fixture.outcomeRules, profileRules: [], stepId: 's06-click-search' });
		expect(rules.filter((rule) => rule.class === 'business_outcome').map((rule) => rule.code)).toEqual([
			'member_not_found',
			'validation_rejected',
			'permission_denied',
		]);
	});
});

describe('resolveCondition', () => {
	it('artifact rule first, then profile, then the catalog default', () => {
		const artifactRule = { ...appErrorProfile, class: 'business_outcome' as const, scope: ['s06-click-search'] };
		expect(
			resolveCondition('app_error', {
				artifactRules: [artifactRule],
				profileRules: [appErrorProfile],
				stepId: 's06-click-search',
			}),
		).toMatchObject({ class: 'business_outcome', source: 'artifact' });
		expect(
			resolveCondition('app_error', { artifactRules: [], profileRules: [appErrorProfile], stepId: 's01-open-app' }),
		).toMatchObject({ class: 'failure', source: 'profile' });
		expect(
			resolveCondition('target_unresolved', { artifactRules: [], profileRules: [], stepId: 's01-open-app' }),
		).toMatchObject({ class: 'failure', source: 'catalog', rule: null });
	});

	it('a code with no rule and no catalog entry is unresolved (never guessed at runtime)', () => {
		expect(resolveCondition('notice_page', { artifactRules: [], profileRules: [], stepId: null })).toBeNull();
	});
});
