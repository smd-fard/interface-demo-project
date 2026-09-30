import type { DenyCode } from '@idp/policy';

/** When the policy said no: before the surface acted, or after it, on the URL the action landed on. */
export type PolicyDenialStage = 'pre_action' | 'post_action';

/**
 * The policy denied an action (invariant 2). `pre_action`: the surface never acted. `post_action`: the action
 * ran but landed off the allowlist (a click that followed a link); navigating back is not attempted. The
 * message carries the kind and the deny code only; `reason` names origins/paths — redact before any sink.
 */
export class PolicyDeniedError extends Error {
	readonly code = 'POLICY_DENIED' as const;

	constructor(
		readonly actionKind: string,
		readonly denyCode: DenyCode,
		readonly reason: string,
		readonly stage: PolicyDenialStage,
	) {
		super(`${actionKind} denied by policy (${denyCode}, ${stage === 'pre_action' ? 'not performed' : 'after acting'})`);
		this.name = 'PolicyDeniedError';
	}

	/** True when the action ran and its landing URL was denied. */
	get postAction(): boolean {
		return this.stage === 'post_action';
	}
}
