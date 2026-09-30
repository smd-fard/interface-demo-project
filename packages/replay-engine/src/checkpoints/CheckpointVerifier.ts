import type { Checkpoint } from '@idp/artifact-schema';
import type { Bindings, Surface } from '@idp/surface';
import type { CheckpointVerdict } from './CheckpointVerdict.js';
import type { ConditionDetector } from './ConditionDetector.js';

/** The surface a `CheckpointVerifier` checks through, plus the optional condition detector it races. */
export interface CheckpointVerifierOptions {
	readonly surface: Pick<Surface, 'check' | 'observe'>;
	/** The condition detectors (step 35+). Omitted = no detection: one bounded `check` per verification. */
	readonly detect?: ConditionDetector;
	/** With a detector: how long each `check` slice may poll before the detector runs again (default 250 ms). */
	readonly sliceMs?: number;
}

const DEFAULT_SLICE_MS = 250;

/**
 * Verifies a checkpoint with a bounded poll of `surface.check`, raced against the condition detectors (invariant
 * 5: "the click didn't throw" is not success). Without a detector it is a single `check` bounded by `timeoutMs`.
 * With one, it alternates observe → detect and a `check` slice, at most `ceil(timeoutMs / sliceMs)` times, so it
 * is bounded by construction (no clock needed). Returns `held`, `condition(code)` or `timeout(observed)`.
 */
export class CheckpointVerifier {
	constructor(private readonly options: CheckpointVerifierOptions) {}

	async verify(checkpoint: Checkpoint, bindings: Bindings, timeoutMs: number): Promise<CheckpointVerdict> {
		const { surface, detect } = this.options;
		if (detect === undefined) {
			const result = await surface.check(checkpoint, bindings, timeoutMs);
			return result.kind === 'held' ? { kind: 'held' } : { kind: 'timeout', observed: result.observed };
		}
		const slice = Math.max(1, Math.min(this.options.sliceMs ?? DEFAULT_SLICE_MS, timeoutMs));
		const polls = Math.max(1, Math.ceil(timeoutMs / slice));
		let observed = '';
		for (let poll = 0; poll < polls; poll += 1) {
			const code = detect(await surface.observe());
			if (code !== null) return { kind: 'condition', code };
			const result = await surface.check(checkpoint, bindings, slice);
			if (result.kind === 'held') return { kind: 'held' };
			observed = result.observed;
		}
		return { kind: 'timeout', observed };
	}
}
