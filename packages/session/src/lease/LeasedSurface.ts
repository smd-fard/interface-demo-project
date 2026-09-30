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
import { LeaseNotHeldError } from '../errors/LeaseNotHeldError.js';
import type { ControlLease } from './ControlLease.js';

/**
 * The lease check on the live session (FR20): it decorates a surface (the policy-guarded one) and refuses
 * every `act` whose actor does not hold the control lease — `agent` / `replay` need `AGENT`, `human` needs
 * `HUMAN` — with `LeaseNotHeldError`, before the inner surface is touched. Observation (`observe`, `check`,
 * `location`, `describe`, `resolve`, `captureEvidence`, `pendingDialog`) is always allowed: it changes nothing.
 */
export class LeasedSurface implements Surface {
	constructor(
		private readonly inner: Surface,
		private readonly lease: ControlLease,
	) {}

	act(action: SurfaceAction): Promise<ActOutcome> {
		const state = this.lease.state();
		const required = action.actor === 'human' ? 'HUMAN' : 'AGENT';
		if (state !== required) return Promise.reject(new LeaseNotHeldError(action.actor, state));
		return this.inner.act(action);
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
