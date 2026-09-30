import { isActionKind } from '../actions/actionRegistry.js';
import type { ResolvedPolicy } from '../config/ResolvedPolicy.js';
import type { ActionIntent } from '../intent/ActionIntent.js';
import { classifyRisk } from '../risk/classifyRisk.js';
import type { PolicyVerdict } from '../verdict/PolicyVerdict.js';
import { checkUrl } from './checkUrl.js';

/**
 * The policy check every action passes before the surface acts (invariant 2), for agent, replay and human
 * alike: the verdict does not depend on the actor. In order: unknown kind → action allowlist → origin → route
 * → risk (irreversible → `require_approval`). The URL checked is `targetUrl` when present (navigate, resolved
 * against `currentUrl`), else `currentUrl`. Pure; never throws.
 */
export function evaluateAction(intent: ActionIntent, policy: ResolvedPolicy): PolicyVerdict {
	const { kind } = intent;
	if (typeof kind !== 'string' || !isActionKind(kind)) {
		return { kind: 'deny', code: 'unknown_action', reason: 'the action kind is not a registered action type' };
	}
	if (!policy.actions.has(kind)) {
		return { kind: 'deny', code: 'action_not_allowed', reason: `action ${kind} is not in the action allowlist` };
	}
	const denied =
		intent.targetUrl !== undefined
			? checkUrl(policy, intent.targetUrl, intent.currentUrl)
			: checkUrl(policy, intent.currentUrl);
	if (denied !== undefined) return denied;

	const { risk, reasons } = classifyRisk({ ...intent, kind }, policy);
	if (risk === 'irreversible') {
		return { kind: 'require_approval', risk, reason: `irreversible: ${reasons.slice(1).join('; ')}` };
	}
	return { kind: 'allow', risk };
}
