import { describe, expect, it } from 'vitest';
import { BANK, fixturePolicyConfig } from '../../test/fixtures/policyConfig.js';
import { resolvePolicy } from '../config/resolvePolicy.js';
import type { ActionIntent, PolicyActor } from '../intent/ActionIntent.js';
import { evaluateAction } from './evaluateAction.js';

const policy = resolvePolicy(fixturePolicyConfig());
const at = (path: string) => `${BANK}${path}`;
const ACTORS: PolicyActor[] = ['agent', 'replay', 'human'];

describe('evaluateAction', () => {
	it('allows a registered, allowlisted action on an allowed route, with its risk', () => {
		expect(
			evaluateAction({ actor: 'agent', kind: 'click', currentUrl: at('/member/search'), targetName: 'Search' }, policy),
		).toEqual({ kind: 'allow', risk: 'reversible' });
		expect(evaluateAction({ actor: 'agent', kind: 'extract', currentUrl: at('/member/1') }, policy)).toEqual({
			kind: 'allow',
			risk: 'read',
		});
	});

	it('denies an unknown kind (e.g. an invented tool name from the model) with unknown_action', () => {
		const verdict = evaluateAction({ actor: 'agent', kind: 'execute_js', currentUrl: at('/') }, policy);
		expect(verdict).toMatchObject({ kind: 'deny', code: 'unknown_action' });
		expect(evaluateAction({ actor: 'agent', kind: 'constructor', currentUrl: at('/') }, policy)).toMatchObject({
			kind: 'deny',
			code: 'unknown_action',
		});
	});

	it('denies a registered kind that is not in allow.actions with action_not_allowed', () => {
		const config = fixturePolicyConfig();
		const readOnly = resolvePolicy({ ...config, allow: { ...config.allow, actions: ['navigate', 'extract', 'wait'] } });
		expect(
			evaluateAction(
				{ actor: 'replay', kind: 'fill', currentUrl: at('/member/search'), targetName: 'Member' },
				readOnly,
			),
		).toMatchObject({ kind: 'deny', code: 'action_not_allowed' });
	});

	it('denies an origin outside the allowlist with origin_not_allowed', () => {
		expect(
			evaluateAction(
				{ actor: 'agent', kind: 'navigate', currentUrl: at('/'), targetUrl: 'https://example.com/' },
				policy,
			),
		).toMatchObject({ kind: 'deny', code: 'origin_not_allowed' });
		expect(
			evaluateAction(
				{ actor: 'agent', kind: 'click', currentUrl: 'http://127.0.0.1:9999/x', targetName: 'Go' },
				policy,
			),
		).toMatchObject({ kind: 'deny', code: 'origin_not_allowed' });
	});

	it('denies non-http and unparseable URLs with origin_not_allowed', () => {
		for (const targetUrl of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x']) {
			expect(
				evaluateAction({ actor: 'agent', kind: 'navigate', currentUrl: at('/'), targetUrl }, policy),
			).toMatchObject({
				kind: 'deny',
				code: 'origin_not_allowed',
			});
		}
		expect(evaluateAction({ actor: 'agent', kind: 'click', currentUrl: 'not a url' }, policy)).toMatchObject({
			kind: 'deny',
			code: 'origin_not_allowed',
		});
	});

	it('denies an excluded route with route_not_allowed', () => {
		expect(
			evaluateAction(
				{ actor: 'agent', kind: 'navigate', currentUrl: at('/'), targetUrl: at('/__admin/faults') },
				policy,
			),
		).toMatchObject({ kind: 'deny', code: 'route_not_allowed' });
		// A relative target resolves against the current page.
		expect(
			evaluateAction({ actor: 'agent', kind: 'navigate', currentUrl: at('/home'), targetUrl: '/__admin/x' }, policy),
		).toMatchObject({ kind: 'deny', code: 'route_not_allowed' });
	});

	it('checks the navigate target, not the current page', () => {
		expect(
			evaluateAction({ actor: 'agent', kind: 'navigate', currentUrl: 'about:blank', targetUrl: at('/login') }, policy),
		).toEqual({ kind: 'allow', risk: 'read' });
	});

	it('requires approval for an irreversible action', () => {
		const verdict = evaluateAction(
			{ actor: 'replay', kind: 'click', currentUrl: at('/subaccount/review'), targetName: 'Confirm', stepId: 's7' },
			policy,
		);
		expect(verdict.kind).toBe('require_approval');
		if (verdict.kind === 'require_approval') {
			expect(verdict.risk).toBe('irreversible');
			expect(verdict.reason).toContain('^Confirm$');
		}
	});

	it('requires approval for an innocuous-named submit whose destination is an irreversible route', () => {
		const verdict = evaluateAction(
			{
				actor: 'human',
				kind: 'click',
				currentUrl: at('/subaccount/new'),
				targetName: 'Next',
				destinationUrl: at('/subaccount/confirm'),
			},
			policy,
		);
		expect(verdict.kind).toBe('require_approval');
		if (verdict.kind === 'require_approval') expect(verdict.reason).toContain('/subaccount/confirm');
		expect(
			evaluateAction(
				{
					actor: 'human',
					kind: 'click',
					currentUrl: at('/subaccount/new'),
					targetName: 'Next',
					destinationUrl: at('/subaccount/review'),
				},
				policy,
			),
		).toEqual({ kind: 'allow', risk: 'reversible' });
	});

	it('evaluates in order: unknown kind, action allowlist, origin, route, risk', () => {
		const config = fixturePolicyConfig();
		const noClick = resolvePolicy({ ...config, allow: { ...config.allow, actions: ['navigate'] } });
		// Not allowlisted beats a bad origin.
		expect(
			evaluateAction(
				{ actor: 'agent', kind: 'click', currentUrl: 'https://example.com/', targetName: 'Confirm' },
				noClick,
			),
		).toMatchObject({ code: 'action_not_allowed' });
		// A bad origin beats an irreversible classification.
		expect(
			evaluateAction(
				{ actor: 'agent', kind: 'click', currentUrl: 'https://example.com/', targetName: 'Confirm' },
				policy,
			),
		).toMatchObject({ code: 'origin_not_allowed' });
		// A denied route beats an irreversible classification.
		expect(
			evaluateAction({ actor: 'agent', kind: 'click', currentUrl: at('/__admin/x'), targetName: 'Confirm' }, policy),
		).toMatchObject({ code: 'route_not_allowed' });
	});

	it('never throws, whatever the input', () => {
		const weird = { actor: 'agent', kind: '', currentUrl: '' } as ActionIntent;
		expect(() => evaluateAction(weird, policy)).not.toThrow();
		expect(evaluateAction(weird, policy).kind).toBe('deny');
	});

	it('does not put the query string (which may carry values) in a deny reason', () => {
		const verdict = evaluateAction(
			{ actor: 'agent', kind: 'navigate', currentUrl: at('/'), targetUrl: 'https://example.com/p?member=12345' },
			policy,
		);
		expect(verdict.kind === 'deny' && verdict.reason).not.toContain('12345');
	});

	describe('gives every actor the same verdict for the same intent (AC9)', () => {
		const intents: Omit<ActionIntent, 'actor'>[] = [
			{ kind: 'click', currentUrl: at('/member/search'), targetName: 'Search' },
			{ kind: 'click', currentUrl: at('/subaccount/review'), targetName: 'Confirm' },
			{ kind: 'navigate', currentUrl: at('/'), targetUrl: 'https://example.com/' },
			{ kind: 'navigate', currentUrl: at('/'), targetUrl: at('/__admin/faults') },
			{ kind: 'fill', currentUrl: at('/member/search'), targetName: 'Member number', declaredRisk: 'read' },
			{ kind: 'shell', currentUrl: at('/') },
		];
		it.each(intents)('%o', (intent) => {
			const [first, ...rest] = ACTORS.map((actor) => evaluateAction({ ...intent, actor }, policy));
			for (const verdict of rest) expect(verdict).toEqual(first);
		});
	});
});
