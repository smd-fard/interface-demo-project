import type { Checkpoint, OutputSpec } from '@idp/artifact-schema';
import type { ElementFingerprint } from '@idp/surface';
import type { ScreenDiff } from './ScreenDiff.js';

/**
 * Where a typed or selected value came from, as the trace keeps it: a param or credential reference, or a
 * non-sensitive literal with its text. A concrete param or credential value is never kept here (invariant 3); a
 * sensitive fill that maps to no param or credential keeps the literal `[REDACTED]` with `sensitive: true`, which
 * the compiler refuses (`UnparameterizedSensitiveValueError`).
 */
export type TraceValue =
	| { readonly kind: 'param'; readonly name: string }
	| { readonly kind: 'credential'; readonly field: 'username' | 'password' }
	| { readonly kind: 'literal'; readonly value: string };

/** The action of a trace step, without any concrete sensitive value. */
export type TraceAction =
	| { readonly kind: 'navigate'; readonly route: string }
	| { readonly kind: 'click' }
	| { readonly kind: 'fill'; readonly value: TraceValue; readonly sensitive: boolean }
	| { readonly kind: 'select'; readonly option: TraceValue }
	| { readonly kind: 'press'; readonly key: 'Enter' | 'Tab' | 'Escape' }
	| { readonly kind: 'extract'; readonly output: string }
	| { readonly kind: 'wait'; readonly until: Checkpoint; readonly timeoutMs: number }
	| { readonly kind: 'dismiss_dialog'; readonly match: string; readonly action: 'accept' | 'dismiss' };

/**
 * `ok`: performed. `refused`: the policy denied it (or an approval was not given), nothing compiled from it.
 * `failed`: it could not be performed (stale ref, unresolved target, wait timeout, …).
 */
export type TraceVerdict = 'ok' | 'refused' | 'failed';

/** One action of a discovery run, by the agent or by a human operator during a handoff. */
export interface TraceStep {
	/** 0-based, in the order the actions happened. */
	readonly index: number;
	readonly actor: 'agent' | 'human';
	/** The operator (`operator:<handle>`) for a human step. */
	readonly operator?: string;
	readonly action: TraceAction;
	/**
	 * The element acted on, fingerprinted before acting (refs are per observation). Its text fields are
	 * placeholderized (`{{memberId}}`) and masked by the redactor; `null` for actions without an element.
	 */
	readonly fingerprint: ElementFingerprint | null;
	/** The model's reason (placeholderized), or a fixed note for loop and human steps. */
	readonly reason: string;
	/**
	 * The route (path and query, placeholderized) of the document acted on — the element's frame, else the top
	 * document — for route-based risk classification. No origin: artifacts never pin an environment.
	 */
	readonly pageRoute: string;
	/** Digest of the observation the action was decided on. */
	readonly digestBefore: string;
	/** Digest of the observation after the action; `null` when it was not performed. */
	readonly digestAfter: string | null;
	/** What changed on screen (for the compiler's checkpoints); `null` when the action was not performed. */
	readonly diff: ScreenDiff | null;
	readonly verdict: TraceVerdict;
	/** The typed error code of a refusal or failure (e.g. `POLICY_DENIED`, `REF_UNKNOWN`). */
	readonly errorCode?: string;
	/** True when the action ran with a human approval grant (an irreversible action). */
	readonly approved?: boolean;
}

/** An output the model declared with `declare_output`. */
export type DeclaredOutput = Required<Pick<OutputSpec, 'name' | 'description' | 'type' | 'sensitive'>>;

/** The verified finish of a run: the model's summary and the final checkpoint that held on screen. */
export interface TraceFinish {
	/** Placeholderized. */
	readonly summary: string;
	readonly finalCheckpoint: Checkpoint;
}

/**
 * The structured record of a discovery run, separate from the model transcript (FR6): every action with its
 * element fingerprint, the screen digests before and after, what changed, who acted and the verdict. It holds
 * no concrete param or credential value; extracted values are not in it either (only the output name). It is
 * the input of the artifact compiler.
 */
export interface DiscoveryTrace {
	readonly steps: readonly TraceStep[];
	readonly outputs: readonly DeclaredOutput[];
	/** Set only when the run met its goal. */
	readonly finish: TraceFinish | null;
}
