import type { TargetRef } from '@idp/artifact-schema';
import { createRedactor, resolvePolicy, type ActionIntent, type LandingVerdict, type PolicyVerdict } from '@idp/policy';
import { describe, expect, it } from 'vitest';
import { ApprovalRequiredError } from '../errors/ApprovalRequiredError.js';
import { DialogPendingError } from '../errors/DialogPendingError.js';
import { PolicyDeniedError } from '../errors/PolicyDeniedError.js';
import type { ElementFingerprint } from '../port/ElementFingerprint.js';
import type { ActionTarget } from '../port/SurfaceAction.js';
import { FakeSurface, fakeFingerprint, fakeLocation, fakeObservation } from '../testing/FakeSurface.js';
import { mockBankPolicyConfig } from '../testing/mockBankPolicyConfig.js';
import { ApprovalGrantRegistry } from './ApprovalGrantRegistry.js';
import { fingerprintKey } from './fingerprintKey.js';
import { PolicyGuardedSurface, type VerdictStage } from './PolicyGuardedSurface.js';

const origin = 'http://127.0.0.1:4010';
const policy = resolvePolicy(mockBankPolicyConfig(origin, { exclude: ['/member/secret/**'] }));

const targetRef = (description: string): ActionTarget => ({
	kind: 'target',
	target: {
		description,
		frame: [{ kind: 'by_name', name: 'content' }],
		ladder: [{ kind: 'role', role: 'button', name: description, exact: true, rationale: 'unit test' }],
	} satisfies TargetRef,
});
const search = targetRef('Search');
const confirm = targetRef('Confirm');

const confirmFingerprint = fakeFingerprint({ name: 'Confirm', visibleText: 'Confirm', nameAttribute: 'btnConfirm' });

function clockAt(start: string) {
	let now = new Date(start).getTime();
	return {
		now: () => new Date(now),
		advance: (ms: number) => {
			now += ms;
		},
	};
}

interface Harness {
	readonly inner: FakeSurface;
	readonly guard: PolicyGuardedSurface;
	readonly grants: ApprovalGrantRegistry;
	readonly clock: ReturnType<typeof clockAt>;
	readonly verdicts: { verdict: PolicyVerdict | LandingVerdict; intent: ActionIntent; stage: VerdictStage }[];
}

function harness(
	options: {
		contentPath?: string;
		fingerprint?: (target: ActionTarget) => ElementFingerprint;
		landingPath?: string;
	} = {},
): Harness {
	const clock = clockAt('2026-09-29T10:00:00.000Z');
	const landingPath = options.landingPath;
	const inner = new FakeSurface({
		location: fakeLocation(origin, options.contentPath ?? '/member/search'),
		fingerprint:
			options.fingerprint ??
			((target) =>
				target.kind === 'target' && target.target.description === 'Confirm' ? confirmFingerprint : fakeFingerprint()),
		...(landingPath === undefined
			? {}
			: {
					onAct: (_action, surface) => {
						surface.setLocation(fakeLocation(origin, landingPath));
					},
				}),
	});
	const grants = new ApprovalGrantRegistry({ clock, defaultTtlMs: 60_000 });
	const verdicts: Harness['verdicts'] = [];
	const guard = new PolicyGuardedSurface({
		inner,
		policy,
		origin,
		grants,
		onVerdict: (verdict, intent, stage) => verdicts.push({ verdict, intent, stage }),
	});
	return { inner, guard, grants, clock, verdicts };
}

describe('PolicyGuardedSurface: allow', () => {
	it('an allowed click is performed once, with the intent built from the target and its frame', async () => {
		const { inner, guard, verdicts } = harness();
		const outcome = await guard.act({ kind: 'click', actor: 'replay', stepId: 's06', target: search });
		expect(outcome.kind).toBe('click');
		expect(outcome.risk).toBe('reversible');
		expect(inner.acts).toHaveLength(1);
		expect(inner.acts[0]).toMatchObject({ kind: 'click', stepId: 's06' });
		expect(verdicts[0]).toMatchObject({
			stage: 'action',
			verdict: { kind: 'allow', risk: 'reversible' },
			intent: {
				actor: 'replay',
				kind: 'click',
				currentUrl: `${origin}/member/search`,
				targetName: 'Search',
				stepId: 's06',
			},
		});
		expect(verdicts[1]).toMatchObject({ stage: 'landing', verdict: { kind: 'allow' } });
	});

	it('a navigate is checked against the origin-resolved route', async () => {
		const { inner, guard, verdicts } = harness();
		await guard.act({ kind: 'navigate', actor: 'agent', route: '/member/search' });
		expect(inner.acts).toHaveLength(1);
		expect(verdicts[0]?.intent).toMatchObject({ kind: 'navigate', targetUrl: `${origin}/member/search` });
	});

	it('an allowed action is forwarded without an approval grant (a grant cannot widen a reversible click)', async () => {
		const { inner, guard, grants } = harness();
		const grant = grants.mint({ requestId: 'req-1', stepId: 's06', grantedBy: 'op-1' });
		await guard.act({ kind: 'click', actor: 'replay', stepId: 's06', target: search, approvalGrant: grant });
		expect(inner.acts[0]?.approvalGrant).toBeUndefined();
	});

	it('non-act methods pass through to the inner surface', async () => {
		const { inner, guard } = harness();
		const redactor = createRedactor({ sensitiveValues: ['12345'] });
		expect((await guard.observe()).url).toBe(fakeObservation(`${origin}/`).url);
		expect(await guard.describe(search)).toEqual(fakeFingerprint());
		expect(await guard.check({ kind: 'text_present', text: 'x', frame: [] }, {}, 0)).toEqual({ kind: 'held' });
		expect((await guard.location()).url).toBe(`${origin}/`);
		expect((await guard.captureEvidence(redactor)).url).toBe(`${origin}/`);
		expect(guard.pendingDialog()).toBeNull();
		await guard.close();
		expect(inner.closed).toBe(true);
	});
});

describe('PolicyGuardedSurface: deny (AC9: whoever acts)', () => {
	it.each(['agent', 'replay', 'human'] as const)(
		'%s: a navigate off the route allowlist never reaches the surface',
		async (actor) => {
			const { inner, guard, verdicts } = harness();
			const error = await guard.act({ kind: 'navigate', actor, route: '/member/secret/1' }).catch((e: unknown) => e);
			expect(error).toBeInstanceOf(PolicyDeniedError);
			expect(error).toMatchObject({ code: 'POLICY_DENIED', denyCode: 'route_not_allowed', stage: 'pre_action' });
			expect((error as PolicyDeniedError).postAction).toBe(false);
			expect(inner.acts).toHaveLength(0);
			expect(verdicts).toHaveLength(1);
			expect(verdicts[0]).toMatchObject({ stage: 'action', verdict: { kind: 'deny', code: 'route_not_allowed' } });
		},
	);

	it('a click on a link to another origin is denied before acting', async () => {
		const { inner, guard } = harness({
			fingerprint: () =>
				fakeFingerprint({ role: 'link', name: 'Elsewhere', tag: 'a', navigatesTo: 'http://elsewhere.invalid/x' }),
		});
		await expect(guard.act({ kind: 'click', actor: 'human', target: search })).rejects.toMatchObject({
			code: 'POLICY_DENIED',
			denyCode: 'origin_not_allowed',
			stage: 'pre_action',
		});
		expect(inner.acts).toHaveLength(0);
	});

	it('a javascript: link is not treated as a navigation target', async () => {
		const { inner, guard } = harness({
			fingerprint: () => fakeFingerprint({ role: 'link', name: 'Help', tag: 'a', navigatesTo: 'javascript:void(0)' }),
		});
		await guard.act({ kind: 'click', actor: 'agent', target: search });
		expect(inner.acts).toHaveLength(1);
	});

	it('an unregistered kind is denied (unknown_action) and never performed', async () => {
		const { inner, guard } = harness();
		const bogus = { kind: 'hover', actor: 'agent', target: search } as unknown as Parameters<typeof guard.act>[0];
		await expect(guard.act(bogus)).rejects.toMatchObject({ code: 'POLICY_DENIED', denyCode: 'unknown_action' });
		expect(inner.acts).toHaveLength(0);
	});

	it('a landing off the allowlist throws a post-action denial (no navigate back)', async () => {
		const { inner, guard, verdicts } = harness({ landingPath: '/member/secret/7' });
		const error = await guard.act({ kind: 'click', actor: 'agent', target: search }).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(PolicyDeniedError);
		expect(error).toMatchObject({ denyCode: 'route_not_allowed', stage: 'post_action' });
		expect((error as PolicyDeniedError).postAction).toBe(true);
		expect(inner.acts).toHaveLength(1);
		expect(verdicts.at(-1)).toMatchObject({ stage: 'landing', verdict: { kind: 'deny' } });
	});

	it('a pending dialog refuses every kind but dismiss_dialog before resolving the target', async () => {
		const { inner, guard } = harness();
		inner.setPendingDialog({ type: 'alert', message: 'Heads up' });
		await expect(guard.act({ kind: 'click', actor: 'agent', target: search })).rejects.toBeInstanceOf(
			DialogPendingError,
		);
		expect(inner.described).toHaveLength(0);
		expect(inner.acts).toHaveLength(0);
		await guard.act({ kind: 'dismiss_dialog', actor: 'agent', match: 'Heads up', action: 'accept' });
		expect(inner.acts).toHaveLength(1);
	});
});

describe('PolicyGuardedSurface: require_approval and grants', () => {
	it('an irreversible click without a grant throws ApprovalRequiredError and never reaches the surface', async () => {
		const { inner, guard, verdicts } = harness();
		const error = await guard
			.act({ kind: 'click', actor: 'replay', stepId: 's12', target: confirm })
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ApprovalRequiredError);
		expect(error).toMatchObject({
			code: 'APPROVAL_REQUIRED',
			risk: 'irreversible',
			stepId: 's12',
			fingerprint: confirmFingerprint,
		});
		expect((error as ApprovalRequiredError).grantRejection).toBeUndefined();
		expect(inner.acts).toHaveLength(0);
		expect(verdicts[0]).toMatchObject({ verdict: { kind: 'require_approval' } });
	});

	it('an irreversible route makes every screen-changing action need approval', async () => {
		// `/subaccount/opened` is the commit endpoint listed in irreversible.routes (config/policy.json).
		const { inner, guard } = harness({ contentPath: '/subaccount/opened' });
		await expect(guard.act({ kind: 'click', actor: 'human', target: search })).rejects.toBeInstanceOf(
			ApprovalRequiredError,
		);
		expect(inner.acts).toHaveLength(0);
	});

	it('an innocuous-named submit whose form posts to an irreversible route needs approval', async () => {
		const next = fakeFingerprint({ name: 'Next', visibleText: 'Next', navigatesTo: `${origin}/subaccount/opened` });
		const { inner, guard, verdicts } = harness({ fingerprint: () => next });
		for (const action of [
			{ kind: 'click' as const, actor: 'human' as const, target: search },
			{ kind: 'press' as const, actor: 'agent' as const, target: search, key: 'Enter' as const },
		]) {
			const error = await guard.act(action).catch((e: unknown) => e);
			expect(error).toBeInstanceOf(ApprovalRequiredError);
			expect((error as ApprovalRequiredError).reason).toContain(
				'destination matches irreversible route /subaccount/opened',
			);
		}
		expect(inner.acts).toHaveLength(0);
		expect(verdicts[0]).toMatchObject({
			verdict: { kind: 'require_approval' },
			intent: { destinationUrl: `${origin}/subaccount/opened` },
		});
	});

	it('a submit that only shows the review page (Continue → /subaccount/confirm) is not irreversible', async () => {
		const continueFp = fakeFingerprint({
			name: 'Continue',
			visibleText: 'Continue',
			navigatesTo: `${origin}/subaccount/confirm?m=12345`,
		});
		const { inner, guard } = harness({ fingerprint: () => continueFp });
		await guard.act({ kind: 'click', actor: 'replay', target: search });
		expect(inner.acts).toHaveLength(1);
	});

	it('a grant bound to the target lets an irreversible-destination submit through once', async () => {
		const next = fakeFingerprint({ name: 'Next', visibleText: 'Next', navigatesTo: `${origin}/subaccount/opened` });
		const { inner, guard, grants } = harness({ fingerprint: () => next });
		const grant = grants.mint({ requestId: 'req-dest', fingerprintKey: fingerprintKey(next), grantedBy: 'op' });
		await guard.act({ kind: 'click', actor: 'agent', target: search, approvalGrant: grant });
		expect(inner.acts).toHaveLength(1);
	});

	it('accepting the Review page\'s commit confirm ("cannot be undone") needs approval', async () => {
		// The Review page (/subaccount/confirm) is not itself irreversible, so a target-less Tab/Enter there can
		// raise the Confirm button's native confirm; accepting it would commit, so its message raises the risk.
		const { inner, guard } = harness({ contentPath: '/subaccount/confirm' });
		inner.setPendingDialog({ type: 'confirm', message: 'This action cannot be undone. Continue?' });
		await expect(
			guard.act({ kind: 'dismiss_dialog', actor: 'agent', match: 'cannot be undone', action: 'accept' }),
		).rejects.toBeInstanceOf(ApprovalRequiredError);
		expect(inner.acts).toHaveLength(0);
	});

	it('a matching grant (by stepId) lets the action through once, with the grant, and consumes it', async () => {
		const { inner, guard, grants } = harness();
		const grant = grants.mint({ requestId: 'req-1', stepId: 's12', grantedBy: 'op-1' });
		const outcome = await guard.act({
			kind: 'click',
			actor: 'replay',
			stepId: 's12',
			declaredRisk: 'reversible',
			target: confirm,
			approvalGrant: grant,
		});
		// The control name raised the declared "reversible" to irreversible: the outcome carries the effective risk.
		expect(outcome.risk).toBe('irreversible');
		expect(inner.acts).toHaveLength(1);
		expect(inner.acts[0]?.approvalGrant).toEqual(grant);

		const reused = await guard
			.act({ kind: 'click', actor: 'replay', stepId: 's12', target: confirm, approvalGrant: grant })
			.catch((e: unknown) => e);
		expect(reused).toBeInstanceOf(ApprovalRequiredError);
		expect(reused).toMatchObject({ grantRejection: 'reused' });
		expect(inner.acts).toHaveLength(1);
	});

	it('a grant bound to the target fingerprint works without a stepId (agent/human path)', async () => {
		const { inner, guard, grants } = harness();
		const grant = grants.mint({
			requestId: 'req-2',
			fingerprintKey: fingerprintKey(confirmFingerprint),
			grantedBy: 'op',
		});
		await guard.act({ kind: 'click', actor: 'agent', target: confirm, approvalGrant: grant });
		expect(inner.acts).toHaveLength(1);
	});

	it('an expired grant is rejected', async () => {
		const { inner, guard, grants, clock } = harness();
		const grant = grants.mint({ requestId: 'req-3', stepId: 's12', grantedBy: 'op-1' });
		clock.advance(60_000);
		await expect(
			guard.act({ kind: 'click', actor: 'replay', stepId: 's12', target: confirm, approvalGrant: grant }),
		).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED', grantRejection: 'expired' });
		expect(inner.acts).toHaveLength(0);
	});

	it('a grant for another step is rejected (mismatch) and stays usable for its own step', async () => {
		const { inner, guard, grants } = harness();
		const grant = grants.mint({ requestId: 'req-4', stepId: 's12', grantedBy: 'op-1' });
		await expect(
			guard.act({ kind: 'click', actor: 'replay', stepId: 's99', target: confirm, approvalGrant: grant }),
		).rejects.toMatchObject({ grantRejection: 'mismatch' });
		expect(inner.acts).toHaveLength(0);
		await guard.act({ kind: 'click', actor: 'replay', stepId: 's12', target: confirm, approvalGrant: grant });
		expect(inner.acts).toHaveLength(1);
	});

	it('a forged or altered grant is rejected (unknown)', async () => {
		const { inner, guard, grants } = harness();
		const real = grants.mint({ requestId: 'req-5', stepId: 's12', grantedBy: 'op-1' });
		const forged = { ...real, requestId: 'req-forged' };
		const extended = { ...real, expiresAt: '2099-01-01T00:00:00.000Z' };
		for (const grant of [forged, extended]) {
			await expect(
				guard.act({ kind: 'click', actor: 'replay', stepId: 's12', target: confirm, approvalGrant: grant }),
			).rejects.toMatchObject({ grantRejection: 'unknown' });
		}
		expect(inner.acts).toHaveLength(0);
	});

	it('a deny outranks a grant', async () => {
		const { inner, guard, grants } = harness();
		const grant = grants.mint({ requestId: 'req-6', stepId: 's1', grantedBy: 'op-1' });
		await expect(
			guard.act({ kind: 'navigate', actor: 'replay', stepId: 's1', route: '/__admin/faults', approvalGrant: grant }),
		).rejects.toBeInstanceOf(PolicyDeniedError);
		expect(inner.acts).toHaveLength(0);
	});
});

describe('ApprovalGrantRegistry', () => {
	it('refuses to mint an unbound grant or a second grant for the same request', () => {
		const { grants } = harness();
		expect(() => grants.mint({ requestId: 'r', grantedBy: 'op' })).toThrow(
			expect.objectContaining({ code: 'APPROVAL_GRANT_INVALID', problem: 'unbound' }),
		);
		grants.mint({ requestId: 'r', stepId: 's', grantedBy: 'op' });
		expect(() => grants.mint({ requestId: 'r', stepId: 's', grantedBy: 'op' })).toThrow(
			expect.objectContaining({ problem: 'duplicate_request' }),
		);
	});

	it('stamps issuedAt/expiresAt from the injected clock', () => {
		const { grants } = harness();
		const grant = grants.mint({ requestId: 'r', stepId: 's', grantedBy: 'op', ttlMs: 1_000 });
		expect(grant).toMatchObject({ issuedAt: '2026-09-29T10:00:00.000Z', expiresAt: '2026-09-29T10:00:01.000Z' });
	});
});

describe('fingerprintKey', () => {
	it('is stable, hashed (no UI text) and differs per target', () => {
		const key = fingerprintKey(confirmFingerprint);
		expect(key).toBe(fingerprintKey({ ...confirmFingerprint }));
		expect(key).not.toContain('Confirm');
		expect(key).not.toBe(fingerprintKey(fakeFingerprint()));
	});
});

describe('PolicyGuardedSurface: navigations it did not start', () => {
	it('checkNavigation evaluates a navigate intent (route, irreversible route) and reports it; it never acts', () => {
		const { inner, guard, verdicts } = harness();
		const from = `${origin}/member/search`;
		expect(guard.checkNavigation(`${origin}/__admin/faults`, from, 'human')).toMatchObject({
			kind: 'deny',
			code: 'route_not_allowed',
		});
		expect(guard.checkNavigation(`${origin}/subaccount/opened`, from, 'human')).toMatchObject({
			kind: 'require_approval',
		});
		expect(guard.checkNavigation(`${origin}/member/search`, from, 'human')).toEqual({ kind: 'allow', risk: 'read' });
		expect(verdicts.map((entry) => [entry.intent.kind, entry.intent.actor, entry.stage])).toEqual([
			['navigate', 'human', 'action'],
			['navigate', 'human', 'action'],
			['navigate', 'human', 'action'],
		]);
		expect(inner.acts).toHaveLength(0);
	});

	it('acting is true only while an act is in progress, including when it throws', async () => {
		const seen: boolean[] = [];
		const inner = new FakeSurface({
			location: fakeLocation(origin, '/member/search'),
			onAct: () => {
				seen.push(guard.acting);
			},
		});
		const guard = new PolicyGuardedSurface({
			inner,
			policy,
			origin,
			grants: new ApprovalGrantRegistry({ clock: clockAt('2026-09-29T10:00:00.000Z') }),
		});
		expect(guard.acting).toBe(false);
		await guard.act({ kind: 'click', actor: 'human', target: search });
		expect(seen).toEqual([true]);
		expect(guard.acting).toBe(false);
		await expect(guard.act({ kind: 'navigate', actor: 'human', route: '/__admin/faults' })).rejects.toBeInstanceOf(
			PolicyDeniedError,
		);
		expect(guard.acting).toBe(false);
	});
});
