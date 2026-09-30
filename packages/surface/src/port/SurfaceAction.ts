import type { Checkpoint, RiskClass, TargetRef } from '@idp/artifact-schema';
import type { PolicyActor } from '@idp/policy';
import type { ApprovalGrant } from '../guard/ApprovalGrant.js';
import type { Bindings } from './Bindings.js';

/** A target: a TargetRef ladder (replay, recorded human actions) or a ref from the latest observation (agent). */
export type ActionTarget =
	{ readonly kind: 'target'; readonly target: TargetRef } | { readonly kind: 'ref'; readonly ref: string };

interface ActionBase {
	/** Who acts. Policy gives the same verdict whoever acts (AC9); the actor is recorded. */
	readonly actor: PolicyActor;
	/** The step being replayed, when there is one. */
	readonly stepId?: string;
	/**
	 * A human approval for this irreversible action. The policy-guarded surface validates and consumes it
	 * (single-use, unexpired, bound to this stepId or target) and strips it from actions policy allows anyway.
	 */
	readonly approvalGrant?: ApprovalGrant;
	/** The risk recorded on the step; it can only raise the policy classification, never lower it. */
	readonly declaredRisk?: RiskClass;
	/** Values for `{{placeholders}}` in the target's ladder and in checkpoints. */
	readonly bindings?: Bindings;
	/** Upper bound for resolving the target and performing the action. */
	readonly timeoutMs?: number;
}

/**
 * One action, mirroring the Step kinds (ACTION_KINDS) with values already resolved: a `fill` carries the
 * concrete text to type (resolved from a param or credential by the caller), marked `sensitive`.
 */
export type SurfaceAction =
	| (ActionBase & { readonly kind: 'navigate'; readonly route: string })
	| (ActionBase & { readonly kind: 'click'; readonly target: ActionTarget })
	| (ActionBase & {
			readonly kind: 'fill';
			readonly target: ActionTarget;
			readonly value: string;
			readonly sensitive: boolean;
	  })
	| (ActionBase & { readonly kind: 'select'; readonly target: ActionTarget; readonly option: string })
	| (ActionBase & { readonly kind: 'press'; readonly target?: ActionTarget; readonly key: 'Enter' | 'Tab' | 'Escape' })
	| (ActionBase & { readonly kind: 'extract'; readonly target: ActionTarget })
	| (ActionBase & { readonly kind: 'wait'; readonly until: Checkpoint; readonly timeoutMs: number })
	| (ActionBase & { readonly kind: 'dismiss_dialog'; readonly match: string; readonly action: 'accept' | 'dismiss' });

/** The action variant of one kind, e.g. `SurfaceActionOf<'fill'>`. */
export type SurfaceActionOf<K extends SurfaceAction['kind']> = Extract<SurfaceAction, { kind: K }>;
