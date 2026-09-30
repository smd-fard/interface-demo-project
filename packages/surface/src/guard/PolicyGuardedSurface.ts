import type { Checkpoint, TargetRef } from '@idp/artifact-schema';
import {
	evaluateAction,
	evaluateLanding,
	isActionKind,
	type ActionIntent,
	type LandingVerdict,
	type PolicyActor,
	type PolicyVerdict,
	type Redactor,
	type ResolvedPolicy,
} from '@idp/policy';
import { ApprovalRequiredError } from '../errors/ApprovalRequiredError.js';
import { DialogPendingError } from '../errors/DialogPendingError.js';
import { PolicyDeniedError } from '../errors/PolicyDeniedError.js';
import { substituteTemplate } from '../internal/substituteTemplate.js';
import type { ActOutcome } from '../port/ActOutcome.js';
import type { Bindings } from '../port/Bindings.js';
import type { CheckResult } from '../port/CheckResult.js';
import type { ElementFingerprint } from '../port/ElementFingerprint.js';
import type { EvidenceCapture } from '../port/EvidenceCapture.js';
import type { Observation, ObserveOptions } from '../port/Observation.js';
import type { PendingDialog } from '../port/PendingDialog.js';
import type { Resolution } from '../port/Resolution.js';
import type { Surface } from '../port/Surface.js';
import type { ActionTarget, SurfaceAction } from '../port/SurfaceAction.js';
import type { SurfaceLocation } from '../port/SurfaceLocation.js';
import type { ApprovalGrantRegistry } from './ApprovalGrantRegistry.js';
import { fingerprintKey } from './fingerprintKey.js';

/** `action`: the verdict before acting. `landing`: the check of the URLs the action landed on. */
export type VerdictStage = 'action' | 'landing';

/**
 * Receives every verdict the guard reaches (allow, deny, require_approval, landing). The guard has no log of
 * its own; the session wires this to the RunLog. The intent carries the target's accessible name and URLs:
 * redact before any sink.
 */
export type VerdictListener = (
	verdict: PolicyVerdict | LandingVerdict,
	intent: ActionIntent,
	stage: VerdictStage,
) => void;

/** Hooks around the inner act (see `PolicyGuardedSurface.actWith`). */
export interface GuardedActHooks {
	readonly beforeInnerAct?: () => Promise<void>;
}

/** Wiring for `PolicyGuardedSurface`: the inner surface it wraps, the resolved policy, origin and grants. */
export interface PolicyGuardedSurfaceOptions {
	/** The surface that acts (e.g. the Playwright web surface). Nothing else may hold it. */
	readonly inner: Surface;
	readonly policy: ResolvedPolicy;
	/** The app origin that `navigate` routes are relative to (the same origin the inner surface uses). */
	readonly origin: string;
	/** The session's grants: consulted (and consumed) for irreversible actions. */
	readonly grants: ApprovalGrantRegistry;
	readonly onVerdict?: VerdictListener;
}

const RANK = { allow_read: 0, allow_reversible: 1, require_approval: 2, deny: 3 } as const;

function rank(verdict: PolicyVerdict): number {
	if (verdict.kind === 'deny') return RANK.deny;
	if (verdict.kind === 'require_approval') return RANK.require_approval;
	return verdict.risk === 'read' ? RANK.allow_read : RANK.allow_reversible;
}

function targetOf(action: SurfaceAction): ActionTarget | undefined {
	return 'target' in action ? action.target : undefined;
}

/** The action without its approval grant: an allowed action must not carry one to the executor. */
function withoutGrant(action: SurfaceAction): SurfaceAction {
	const { approvalGrant, ...rest } = action;
	void approvalGrant;
	return rest as SurfaceAction;
}

function isHttpUrl(url: string): boolean {
	return URL.canParse(url) && ['http:', 'https:'].includes(new URL(url).protocol);
}

function sameFramePath(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((hop, index) => hop === b[index]);
}

/** The URLs to evaluate: the top document and every frame, except blank documents (`about:`). */
function pageUrls(location: SurfaceLocation): string[] {
	const urls = [location.url, ...location.frames.map((frame) => frame.url)];
	return [...new Set(urls)].filter((url) => !url.startsWith('about:'));
}

interface Evaluation {
	readonly verdict: PolicyVerdict;
	readonly intent: ActionIntent;
	readonly fingerprint?: ElementFingerprint;
}

/**
 * The `Surface` that session, replay and agent receive (invariant 2): it decorates any surface and runs the
 * policy check before every `act`, for agent, replay and human alike (AC9).
 *
 * Before acting it builds an `ActionIntent` — the resolved target's accessible name (via the inner
 * `describe`) and the URL of the frame holding it; a `navigate` route resolved against the origin; for
 * actions without a target, every frame's URL, keeping the most restrictive verdict — and calls
 * `evaluateAction`. A click or press on a link or form control is also checked against where it would
 * navigate (`navigatesTo`, http(s) only): it must land on the allowlist, and an irreversible route there
 * (`destinationUrl`) makes it need approval. `deny` → `PolicyDeniedError` (pre_action); `require_approval` →
 * `ApprovalRequiredError` unless the action carries a grant from `grants` that is bound to the same stepId or
 * target, unused and unexpired (the grant is then consumed and forwarded). An allowed action is forwarded
 * without its grant, so a grant can never widen a reversible action. After acting, every frame's URL passes
 * `evaluateLanding`; a denied landing throws `PolicyDeniedError` (post_action) and is not navigated back.
 * Every other method passes through.
 */
export class PolicyGuardedSurface implements Surface {
	private inFlight = 0;

	constructor(private readonly options: PolicyGuardedSurfaceOptions) {}

	/**
	 * Whether an `act` is in progress through this guard. Its navigations were checked before acting (and are
	 * checked on landing), so the human-action recorder does not check them again.
	 */
	get acting(): boolean {
		return this.inFlight > 0;
	}

	/**
	 * The policy verdict for a navigation this guard did not start (e.g. a URL typed in the address bar during
	 * a handoff): a `navigate` intent to `targetUrl` from `currentUrl` — allowlist (origin, route) and
	 * irreversible routes. Reported to `onVerdict` like any action verdict; never acts.
	 */
	checkNavigation(targetUrl: string, currentUrl: string, actor: PolicyActor): PolicyVerdict {
		const intent: ActionIntent = { actor, kind: 'navigate', currentUrl, targetUrl };
		const verdict = evaluateAction(intent, this.options.policy);
		this.report(verdict, intent, 'action');
		return verdict;
	}

	private report(verdict: PolicyVerdict | LandingVerdict, intent: ActionIntent, stage: VerdictStage): void {
		this.options.onVerdict?.(verdict, intent, stage);
	}

	private async evaluate(action: SurfaceAction): Promise<Evaluation> {
		const { policy, inner } = this.options;
		const location = await inner.location();
		const base: ActionIntent = {
			actor: action.actor,
			kind: action.kind,
			currentUrl: location.url,
			...(action.stepId === undefined ? {} : { stepId: action.stepId }),
			...(action.declaredRisk === undefined ? {} : { declaredRisk: action.declaredRisk }),
		};
		if (!isActionKind(action.kind)) return { verdict: evaluateAction(base, policy), intent: base };

		if (action.kind === 'navigate') {
			const route = substituteTemplate(action.route, action.bindings ?? {});
			const targetUrl = URL.canParse(route, this.options.origin) ? new URL(route, this.options.origin).href : route;
			const intent = { ...base, targetUrl };
			return { verdict: evaluateAction(intent, policy), intent };
		}

		const target = targetOf(action);
		if (target !== undefined) {
			const fingerprint = await inner.describe(target, action.bindings ?? {});
			const frame = location.frames.find((candidate) => sameFramePath(candidate.path, fingerprint.framePath));
			const name = fingerprint.name !== '' ? fingerprint.name : fingerprint.visibleText;
			// Where a click or press would navigate (link href / form action): checked for landing (allowlist) and
			// for irreversible routes (a commit endpoint behind an innocuous-named submit still needs approval).
			const navigates =
				(action.kind === 'click' || action.kind === 'press') &&
				fingerprint.navigatesTo !== null &&
				isHttpUrl(fingerprint.navigatesTo)
					? fingerprint.navigatesTo
					: null;
			const intent: ActionIntent = {
				...base,
				currentUrl: frame?.url ?? location.url,
				targetName: name,
				...(navigates === null ? {} : { destinationUrl: navigates }),
			};
			const verdict = evaluateAction(intent, policy);
			if (verdict.kind !== 'deny' && navigates !== null) {
				const landing = evaluateLanding(navigates, policy);
				if (landing.kind === 'deny')
					return { verdict: landing, intent: { ...intent, targetUrl: navigates }, fingerprint };
			}
			return { verdict, intent, fingerprint };
		}

		// No target (press on the focus, wait, dismiss_dialog): the action may affect any frame, so every frame
		// is evaluated and the most restrictive verdict wins.
		const dialog = action.kind === 'dismiss_dialog' ? inner.pendingDialog() : null;
		let worst: Evaluation | undefined;
		for (const url of pageUrls(location)) {
			const intent: ActionIntent = {
				...base,
				currentUrl: url,
				...(dialog === null ? {} : { targetName: dialog.message }),
			};
			const verdict = evaluateAction(intent, policy);
			if (worst === undefined || rank(verdict) > rank(worst.verdict)) worst = { verdict, intent };
		}
		return worst ?? { verdict: evaluateAction(base, policy), intent: base };
	}

	act(action: SurfaceAction): Promise<ActOutcome> {
		return this.actWith(action, {});
	}

	/**
	 * `act` with hooks, for the human-action recorder: `beforeInnerAct` runs after the policy allowed the
	 * action (and any grant was consumed), immediately before the inner surface acts.
	 */
	async actWith(action: SurfaceAction, hooks: GuardedActHooks): Promise<ActOutcome> {
		this.inFlight += 1;
		try {
			return await this.guardedAct(action, hooks);
		} finally {
			this.inFlight -= 1;
		}
	}

	private async guardedAct(action: SurfaceAction, hooks: GuardedActHooks): Promise<ActOutcome> {
		const dialog = this.options.inner.pendingDialog();
		// A native dialog blocks the page: fail fast (as the inner surface would) without touching the DOM.
		if (dialog !== null && action.kind !== 'dismiss_dialog') throw new DialogPendingError(action.kind, dialog.type);

		const { verdict, intent, fingerprint } = await this.evaluate(action);
		this.report(verdict, intent, 'action');
		let forwarded: SurfaceAction;
		if (verdict.kind === 'deny') {
			throw new PolicyDeniedError(action.kind, verdict.code, verdict.reason, 'pre_action');
		} else if (verdict.kind === 'require_approval') {
			const details = {
				actionKind: action.kind,
				reason: verdict.reason,
				...(action.stepId === undefined ? {} : { stepId: action.stepId }),
				...(fingerprint === undefined ? {} : { fingerprint }),
			};
			const grant = action.approvalGrant;
			if (grant === undefined) throw new ApprovalRequiredError(details);
			const check = this.options.grants.consume(grant, {
				...(action.stepId === undefined ? {} : { stepId: action.stepId }),
				...(fingerprint === undefined ? {} : { fingerprintKey: fingerprintKey(fingerprint) }),
			});
			if (check.kind === 'rejected') throw new ApprovalRequiredError({ ...details, grantRejection: check.reason });
			forwarded = action;
		} else {
			forwarded = withoutGrant(action);
		}

		await hooks.beforeInnerAct?.();
		const outcome = await this.options.inner.act(forwarded);

		const landed = await this.options.inner.location();
		for (const url of pageUrls(landed)) {
			const landing = evaluateLanding(url, this.options.policy);
			if (landing.kind === 'deny') {
				this.report(landing, intent, 'landing');
				throw new PolicyDeniedError(action.kind, landing.code, landing.reason, 'post_action');
			}
		}
		this.report({ kind: 'allow' }, intent, 'landing');
		return outcome;
	}

	observe(opts?: ObserveOptions): Promise<Observation> {
		return this.options.inner.observe(opts);
	}

	resolve(target: TargetRef, bindings?: Bindings): Promise<Resolution> {
		return this.options.inner.resolve(target, bindings);
	}

	check(checkpoint: Checkpoint, bindings: Bindings, timeoutMs: number): Promise<CheckResult> {
		return this.options.inner.check(checkpoint, bindings, timeoutMs);
	}

	describe(target: ActionTarget, bindings?: Bindings): Promise<ElementFingerprint> {
		return this.options.inner.describe(target, bindings);
	}

	captureEvidence(redactor: Redactor): Promise<EvidenceCapture> {
		return this.options.inner.captureEvidence(redactor);
	}

	location(): Promise<SurfaceLocation> {
		return this.options.inner.location();
	}

	pendingDialog(): PendingDialog | null {
		return this.options.inner.pendingDialog();
	}

	close(): Promise<void> {
		return this.options.inner.close();
	}
}
