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
	/** The current top frame (re-read on the retry, so a reloaded frameset is picked up). */
	readonly root: () => F;
	/** Builds the locator for one rung inside the resolved frame (`rungToLocator` for Playwright). */
	readonly toLocator: (frame: F, rung: LocatorRung, bindings: Bindings) => L;
	/** Pause before the single re-resolution (default 100 ms). */
	readonly sleep?: (ms: number) => Promise<void>;
	readonly retryDelayMs?: number;
}

/** The rung that matched exactly one element, with its frame and locator (internal: holds browser objects). */
export interface LadderMatch<F, L> {
	readonly rungIndex: number;
	readonly rungKind: LocatorRungKind;
	readonly frame: F;
	readonly locator: L;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const ATTEMPTS = 2;

/**
 * Walks a target's ladder in order inside its frame scope; the first rung whose locator matches exactly one
 * element wins. When no rung does (or the frame is missing or detached), it re-resolves the frame once —
 * a frameset may have been reloading — and then throws `TargetNotResolvedError` with each rung's count.
 */
export class LadderResolver<F extends FrameLike<F>, L extends Countable> {
	constructor(private readonly deps: LadderResolverDeps<F, L>) {}

	async resolve(target: TargetRef, bindings: Bindings): Promise<LadderMatch<F, L>> {
		const sleep = this.deps.sleep ?? defaultSleep;
		let observations: RungObservation[] = [];
		for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
			const last = attempt === ATTEMPTS - 1;
			let frame: F;
			try {
				frame = await resolveFrameScope(this.deps.root(), target.frame);
			} catch (error) {
				if (error instanceof FrameNotFoundError && !last) {
					await sleep(this.deps.retryDelayMs ?? 100);
					continue;
				}
				throw error;
			}
			observations = [];
			for (const [index, rung] of target.ladder.entries()) {
				const locator = this.deps.toLocator(frame, rung, bindings);
				try {
					const matches = await locator.count();
					if (matches === 1) return { rungIndex: index, rungKind: rung.kind, frame, locator };
					observations.push({ index, kind: rung.kind, matches });
				} catch (error) {
					if (error instanceof BindingMissingError) throw error;
					const message = error instanceof Error ? (error.message.split('\n')[0] ?? error.name) : String(error);
					observations.push({ index, kind: rung.kind, matches: 0, error: message });
				}
			}
			if (!last) await sleep(this.deps.retryDelayMs ?? 100);
		}
		throw new TargetNotResolvedError(target.description, observations);
	}
}
