import type { Checkpoint, TargetRef } from '@idp/artifact-schema';
import type { Redactor } from '@idp/policy';
import type { Bindings } from './Bindings.js';
import type { ActOutcome } from './ActOutcome.js';
import type { CheckResult } from './CheckResult.js';
import type { ElementFingerprint } from './ElementFingerprint.js';
import type { EvidenceCapture } from './EvidenceCapture.js';
import type { Observation, ObserveOptions } from './Observation.js';
import type { PendingDialog } from './PendingDialog.js';
import type { Resolution } from './Resolution.js';
import type { ActionTarget, SurfaceAction } from './SurfaceAction.js';
import type { SurfaceLocation } from './SurfaceLocation.js';

/**
 * The perception-and-action port between the system and a target application (R7.1). Every other package
 * sees only this interface; the Playwright web adapter is one implementation. No browser types appear here.
 */
export interface Surface {
	/** The frame-aware accessibility tree plus text, titles, dialog and last load. Refs are valid until the next call. */
	observe(opts?: ObserveOptions): Promise<Observation>;
	/**
	 * Walks the target's ladder in order and returns the first rung that matches exactly one element.
	 * Throws `TargetNotResolvedError` (per-rung match counts) or `FrameNotFoundError`.
	 */
	resolve(target: TargetRef, bindings?: Bindings): Promise<Resolution>;
	/** Performs one action of a registered kind. Policy is applied by the guarded decorator, not here. */
	act(action: SurfaceAction): Promise<ActOutcome>;
	/** Polls a checkpoint until it holds or `timeoutMs` passes (0 = a single evaluation). */
	check(checkpoint: Checkpoint, bindings: Bindings, timeoutMs: number): Promise<CheckResult>;
	/** Fingerprints a target (a ladder or an observation ref) for the artifact compiler. */
	describe(target: ActionTarget, bindings?: Bindings): Promise<ElementFingerprint>;
	/** A masked screenshot and the redacted a11y tree, ready for the evidence store. */
	captureEvidence(redactor: Redactor): Promise<EvidenceCapture>;
	/** URL and title of the top document and every frame. */
	location(): Promise<SurfaceLocation>;
	pendingDialog(): PendingDialog | null;
	close(): Promise<void>;
}
