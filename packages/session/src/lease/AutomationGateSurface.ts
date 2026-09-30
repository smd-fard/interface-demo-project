import type { Checkpoint, TargetRef } from '@idp/artifact-schema';
import type { Redactor } from '@idp/policy';
import type {
	ActionTarget,
	ActOutcome,
	Bindings,
	CheckResult,
	ElementFingerprint,
	EvidenceCapture,
	Observation,
	ObserveOptions,
	PendingDialog,
	Resolution,
	Surface,
	SurfaceAction,
	SurfaceLocation,
} from '@idp/surface';

/** What the gate needs from the human-action recorder: run one automation act on the locked page. */
export interface AutomationGate {
	automationAct<T>(run: () => Promise<T>): Promise<T>;
}

/**
 * The innermost decorator of the automation's surface in an attended session (FR1): the page is locked (every
 * person's gesture is blocked) whenever the lease is not `HUMAN`, and this lets the automation's own input
 * through for exactly the duration of one act. It sits under the policy guard and the lease check, so the page
 * opens only for an act the lease allowed and the policy allowed. A human act is never let through here (the
 * recorder mediates those). Everything else is delegated unchanged.
 */
export class AutomationGateSurface implements Surface {
	constructor(
		private readonly inner: Surface,
		private readonly gate: AutomationGate,
	) {}

	act(action: SurfaceAction): Promise<ActOutcome> {
		if (action.actor === 'human') return this.inner.act(action);
		return this.gate.automationAct(() => this.inner.act(action));
	}

	observe(opts?: ObserveOptions): Promise<Observation> {
		return this.inner.observe(opts);
	}

	resolve(target: TargetRef, bindings?: Bindings): Promise<Resolution> {
		return this.inner.resolve(target, bindings);
	}

	check(checkpoint: Checkpoint, bindings: Bindings, timeoutMs: number): Promise<CheckResult> {
		return this.inner.check(checkpoint, bindings, timeoutMs);
	}

	describe(target: ActionTarget, bindings?: Bindings): Promise<ElementFingerprint> {
		return this.inner.describe(target, bindings);
	}

	captureEvidence(redactor: Redactor): Promise<EvidenceCapture> {
		return this.inner.captureEvidence(redactor);
	}

	location(): Promise<SurfaceLocation> {
		return this.inner.location();
	}

	pendingDialog(): PendingDialog | null {
		return this.inner.pendingDialog();
	}

	close(): Promise<void> {
		return this.inner.close();
	}
}
