import type { ActionKind, PolicyConfig } from '@idp/artifact-schema';
import type { RouteMatcher } from './matchRouteGlob.js';

/** A compiled irreversible control-name rule. */
export interface ControlNameRule {
	readonly source: string;
	readonly regex: RegExp;
}

/** A compiled irreversible route rule. */
export interface IrreversibleRouteRule {
	readonly glob: string;
	readonly matches: RouteMatcher;
}

/**
 * A `PolicyConfig` compiled into matchers by `resolvePolicy`. Frozen; the input of `evaluateAction`,
 * `evaluateLanding` and `classifyRisk`. Its `redaction` section can be passed to `createRedactor` directly.
 */
export interface ResolvedPolicy {
	readonly version: string;
	/** Normalized allowed origins (`new URL(o).origin`). */
	readonly origins: ReadonlySet<string>;
	readonly actions: ReadonlySet<ActionKind>;
	readonly irreversibleControlNames: readonly ControlNameRule[];
	readonly irreversibleRoutes: readonly IrreversibleRouteRule[];
	readonly redaction: PolicyConfig['redaction'];
	readonly approvalExpiresMs: number;
	/** True when `path` matches an include glob and no exclude glob of a rule for `origin`. No rule = denied. */
	isRouteAllowed(origin: string, path: string): boolean;
}
