import type { LocatorRung, LocatorRungKind, TargetRef } from '@idp/artifact-schema';
import { BindingMissingError } from '../errors/BindingMissingError.js';
import { FrameNotFoundError } from '../errors/FrameNotFoundError.js';
import { TargetNotResolvedError, type RungObservation } from '../errors/TargetNotResolvedError.js';
import type { Bindings } from '../port/Bindings.js';
import { resolveFrameScope, type FrameLike } from './FrameResolver.js';

/** Something that can be counted, like a Playwright `Locator`. */
export interface Countable {
	count(): Promise<number>;
}

/** The frame and locator primitives the ladder resolver runs on, injected so it is unit-testable without a browser. */
export interface LadderResolverDeps<F, L> {
	/** The current top frame (re-read on every pass, so a reloaded frameset is picked up). */
	readonly root: () => F;
	/** Builds the locator for one rung inside the resolved frame (`rungToLocator` for Playwright). */
	readonly toLocator: (frame: F, rung: LocatorRung, bindings: Bindings) => L;
	/** Waits between passes. Default: a real timer. */
	readonly sleep?: (ms: number) => Promise<void>;
	/** The clock the resolve bound is measured on (ms). Default `Date.now`. */
	readonly now?: () => number;
	/** First pause between passes (default 100 ms); it grows ×1.5 per pass up to `MAX_BACKOFF_MS`. */
	readonly retryDelayMs?: number;
	/**
	 * How long `resolve` keeps polling when the caller gives no bound (default `DEFAULT_LADDER_TIMEOUT_MS`,
	 * 100 ms: one re-resolution after a pause, for the recorder and test helpers).
	 */
	readonly defaultTimeoutMs?: number;
}

/** The rung that matched exactly one element, with its frame and locator (internal: holds browser objects). */
export interface LadderMatch<F, L> {
	readonly rungIndex: number;
	readonly rungKind: LocatorRungKind;
	readonly frame: F;
	readonly locator: L;
}

/** The bound of a `resolve` without an explicit one: a single re-resolution after the first pause. */
export const DEFAULT_LADDER_TIMEOUT_MS = 100;
/** The longest pause between two passes. */
export const MAX_BACKOFF_MS = 250;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Walks a target's ladder in order inside its frame scope; the first rung whose locator matches exactly one
 * element wins. When no rung does (or the frame is missing or detached), it polls — re-resolving the frame
 * each pass, since a frameset may be reloading — with a short growing backoff (100 ms → 250 ms) until
 * `timeoutMs`, then throws `TargetNotResolvedError` with each rung's count from the last pass (or the last
 * `FrameNotFoundError`). `timeoutMs` 0 is a single pass. A missing binding is thrown at once.
 *
 * Trade-off (ladder order per pass): every pass walks all rungs in order and accepts the first rung with
 * exactly one match, so the top rung always wins when its element is there. A lower rung can win before a
 * late top-rung element renders only if it already matches exactly one *other* element — the same drift
 * (rung > 0, logged) it would be without polling. A grace period reserved for rung 0 was rejected: it would
 * delay every genuine drift resolution by that grace, and a late element is normally late for every rung.
 * Ambiguity (several matches) on a rung still falls through to the next rung in the same pass, as before.
 */
export class LadderResolver<F extends FrameLike<F>, L extends Countable> {
	constructor(private readonly deps: LadderResolverDeps<F, L>) {}

	async resolve(target: TargetRef, bindings: Bindings, timeoutMs?: number): Promise<LadderMatch<F, L>> {
		const sleep = this.deps.sleep ?? defaultSleep;
		const now = this.deps.now ?? Date.now;
		const deadline = now() + Math.max(0, timeoutMs ?? this.deps.defaultTimeoutMs ?? DEFAULT_LADDER_TIMEOUT_MS);
		let backoff = this.deps.retryDelayMs ?? 100;
		for (;;) {
			const pass = await this.pass(target, bindings);
			if (pass.kind === 'match') return pass.match;
			const remaining = deadline - now();
			if (remaining <= 0) {
				if (pass.kind === 'frame_missing') throw pass.error;
				throw new TargetNotResolvedError(target.description, pass.observations);
			}
			await sleep(Math.min(backoff, remaining));
			backoff = Math.min(MAX_BACKOFF_MS, Math.round(backoff * 1.5));
		}
	}

	/** One pass over the ladder in the current frame tree. */
	private async pass(target: TargetRef, bindings: Bindings): Promise<Pass<F, L>> {
		let frame: F;
		try {
			frame = await resolveFrameScope(this.deps.root(), target.frame);
		} catch (error) {
			if (error instanceof FrameNotFoundError) return { kind: 'frame_missing', error };
			throw error;
		}
		const observations: RungObservation[] = [];
		for (const [index, rung] of target.ladder.entries()) {
			const locator = this.deps.toLocator(frame, rung, bindings);
			try {
				const matches = await locator.count();
				if (matches === 1) return { kind: 'match', match: { rungIndex: index, rungKind: rung.kind, frame, locator } };
				observations.push({ index, kind: rung.kind, matches });
			} catch (error) {
				if (error instanceof BindingMissingError) throw error;
				// Counting failed (e.g. the frame detached mid-pass): recorded on the rung, and the next pass retries.
				const message = error instanceof Error ? (error.message.split('\n')[0] ?? error.name) : String(error);
				observations.push({ index, kind: rung.kind, matches: 0, error: message });
			}
		}
		return { kind: 'no_match', observations };
	}
}

type Pass<F, L> =
	| { readonly kind: 'match'; readonly match: LadderMatch<F, L> }
	| { readonly kind: 'frame_missing'; readonly error: FrameNotFoundError }
	| { readonly kind: 'no_match'; readonly observations: RungObservation[] };
