import type { TargetRef } from '@idp/artifact-schema';
import { asMaskedScreenshot, type Redactor } from '@idp/policy';
import type { ActOutcome } from '../port/ActOutcome.js';
import type { CheckResult } from '../port/CheckResult.js';
import type { ElementFingerprint } from '../port/ElementFingerprint.js';
import type { EvidenceCapture } from '../port/EvidenceCapture.js';
import type { Observation } from '../port/Observation.js';
import type { PendingDialog } from '../port/PendingDialog.js';
import type { Resolution } from '../port/Resolution.js';
import type { Surface } from '../port/Surface.js';
import type { ActionTarget, SurfaceAction } from '../port/SurfaceAction.js';
import type { SurfaceLocation } from '../port/SurfaceLocation.js';

/** A fingerprint with neutral defaults (a `Search` button in the `content` frame), overridable per field. */
export function fakeFingerprint(overrides: Partial<ElementFingerprint> = {}): ElementFingerprint {
	return {
		role: 'button',
		name: 'Search',
		tag: 'input',
		nameAttribute: null,
		inputType: 'submit',
		labelCellText: null,
		rowHeaderText: null,
		columnHeaderText: null,
		framePath: ['content'],
		frameScope: [{ kind: 'by_name', name: 'content' }],
		container: null,
		navigatesTo: null,
		visibleText: 'Search',
		...overrides,
	};
}

/** A location with a top document and a `content` frame showing `contentUrl`. */
export function fakeLocation(origin: string, contentPath: string): SurfaceLocation {
	return {
		url: `${origin}/`,
		title: 'CoreOne',
		frames: [
			{ path: [], name: '', url: `${origin}/`, title: 'CoreOne' },
			{ path: ['content'], name: 'content', url: `${origin}${contentPath}`, title: 'Content' },
		],
	};
}

/** An empty observation at `url` (a `document` root with no children). */
export function fakeObservation(url: string, overrides: Partial<Observation> = {}): Observation {
	return {
		url,
		title: '',
		frames: [],
		tree: { role: 'document', name: '', framePath: [], children: [] },
		pendingDialog: null,
		lastNavigation: null,
		digest: 'fake',
		...overrides,
	};
}

/** The script a `FakeSurface` follows: location, observations, fingerprints, act hook, injected throw and check results. */
export interface FakeSurfaceOptions {
	/** Where the fake is; `setLocation` changes it (e.g. from `onAct`, to simulate a landing). */
	readonly location: SurfaceLocation;
	/** Returned by `observe()` in order; the last one repeats. Default: an empty observation at the location. */
	readonly observations?: readonly Observation[];
	/** The fingerprint `describe`/`resolve` return for a target. Default: `fakeFingerprint()`. */
	readonly fingerprint?: (target: ActionTarget) => ElementFingerprint;
	/** Runs on every recorded `act` call (after the throw injection); may return the outcome. */
	readonly onAct?: (action: SurfaceAction, surface: FakeSurface) => ActOutcome | undefined;
	/** Throw `error` from the `call`-th `act` (1-based), after recording it. */
	readonly throwOnActCall?: { readonly call: number; readonly error: Error };
	/** Results `check` returns in order; the last repeats. Default: held. */
	readonly checks?: readonly CheckResult[];
	readonly pendingDialog?: PendingDialog | null;
}

/**
 * A scripted `Surface` for unit tests (no browser): records every `act` and `describe`, returns scripted
 * observations, fingerprints and check results, and can throw on the N-th `act`.
 */
export class FakeSurface implements Surface {
	readonly acts: SurfaceAction[] = [];
	readonly described: ActionTarget[] = [];
	closed = false;
	private currentLocation: SurfaceLocation;
	private dialog: PendingDialog | null;
	private observeCalls = 0;
	private checkCalls = 0;

	constructor(private readonly options: FakeSurfaceOptions) {
		this.currentLocation = options.location;
		this.dialog = options.pendingDialog ?? null;
	}

	setLocation(location: SurfaceLocation): void {
		this.currentLocation = location;
	}

	setPendingDialog(dialog: PendingDialog | null): void {
		this.dialog = dialog;
	}

	private fingerprintOf(target: ActionTarget): ElementFingerprint {
		return this.options.fingerprint?.(target) ?? fakeFingerprint();
	}

	async observe(): Promise<Observation> {
		const scripted = this.options.observations ?? [];
		const index = Math.min(this.observeCalls, scripted.length - 1);
		this.observeCalls += 1;
		return scripted[index] ?? fakeObservation(this.currentLocation.url, { pendingDialog: this.dialog });
	}

	async resolve(target: TargetRef): Promise<Resolution> {
		return { rungIndex: 0, rungKind: 'role', fingerprint: this.fingerprintOf({ kind: 'target', target }) };
	}

	async act(action: SurfaceAction): Promise<ActOutcome> {
		this.acts.push(action);
		const injected = this.options.throwOnActCall;
		if (injected !== undefined && injected.call === this.acts.length) throw injected.error;
		const outcome = this.options.onAct?.(action, this);
		return outcome ?? { kind: action.kind, url: this.currentLocation.url, navigation: null };
	}

	async check(): Promise<CheckResult> {
		const scripted = this.options.checks ?? [];
		const index = Math.min(this.checkCalls, scripted.length - 1);
		this.checkCalls += 1;
		return scripted[index] ?? { kind: 'held' };
	}

	async describe(target: ActionTarget): Promise<ElementFingerprint> {
		this.described.push(target);
		return this.fingerprintOf(target);
	}

	async captureEvidence(redactor: Redactor): Promise<EvidenceCapture> {
		const observation = await this.observe();
		return {
			// No pixels at all: trivially masked.
			screenshot: asMaskedScreenshot(new Uint8Array()),
			a11yTree: redactor.redact(observation.tree),
			url: redactor.redactString(observation.url),
		};
	}

	async location(): Promise<SurfaceLocation> {
		return this.currentLocation;
	}

	pendingDialog(): PendingDialog | null {
		return this.dialog;
	}

	async close(): Promise<void> {
		this.closed = true;
	}
}
