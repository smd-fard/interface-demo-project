import type { RiskClass } from '@idp/artifact-schema';

/** Why an action was denied. Stable codes; they appear in logs, results and intervention requests. */
export type DenyCode = 'origin_not_allowed' | 'route_not_allowed' | 'action_not_allowed' | 'unknown_action';

/** The action may run; `risk` is its classified (never lowered) risk. */
export interface AllowVerdict {
	readonly kind: 'allow';
	readonly risk: Exclude<RiskClass, 'irreversible'>;
}

/** The action is irreversible: it runs only with a human approval (an intervention). */
export interface RequireApprovalVerdict {
	readonly kind: 'require_approval';
	readonly risk: 'irreversible';
	readonly reason: string;
}

/** The action must not run. */
export interface DenyVerdict<C extends DenyCode = DenyCode> {
	readonly kind: 'deny';
	readonly code: C;
	readonly reason: string;
}

/**
 * The result of `evaluateAction`, discriminated on `kind`. Reasons carry origins, paths, rule sources and
 * kinds — never query strings, typed values or control names — but are still redacted before any sink.
 */
export type PolicyVerdict = AllowVerdict | RequireApprovalVerdict | DenyVerdict;

/** The result of `evaluateLanding`: the URL an action landed on is either allowed or off the allowlist. */
export type LandingVerdict = { readonly kind: 'allow' } | DenyVerdict<'origin_not_allowed' | 'route_not_allowed'>;
