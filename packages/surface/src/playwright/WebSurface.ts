import type { Checkpoint, TargetRef } from '@idp/artifact-schema';
import type { Clock } from '@idp/evidence';
import type { Redactor } from '@idp/policy';
import type { Frame, Locator, Page } from 'playwright';
import type { ActionContext, ResolvedTarget } from '../actions/ActionContext.js';
import { executeAction } from '../actions/executeAction.js';
import type { DialogMonitor } from '../dialogs/DialogMonitor.js';
import { SurfaceClosedError } from '../errors/SurfaceClosedError.js';
import { UnknownRefError } from '../errors/UnknownRefError.js';
import { captureMaskedScreenshot } from '../evidence/captureMaskedScreenshot.js';
import { fingerprintElement } from '../locators/fingerprintElement.js';
import { frameAtPath, framePathOf } from '../locators/FrameResolver.js';
import { LadderResolver, type LadderMatch } from '../locators/LadderResolver.js';
import { rungToLocator } from '../locators/rungToLocator.js';
import type { ActOutcome } from '../port/ActOutcome.js';
import type { Bindings } from '../port/Bindings.js';
import type { CheckResult } from '../port/CheckResult.js';
import type { ElementFingerprint } from '../port/ElementFingerprint.js';
import type { EvidenceCapture } from '../port/EvidenceCapture.js';
import type { Observation, ObserveOptions } from '../port/Observation.js';
import type { PendingDialog } from '../port/PendingDialog.js';
import type { Resolution } from '../port/Resolution.js';
import type { Surface } from '../port/Surface.js';
import type { ActionTarget, SurfaceAction } from '../port/SurfaceAction.js';
import type { SurfaceLocation } from '../port/SurfaceLocation.js';
import { buildA11yTree, type RefTarget } from '../snapshot/a11ySnapshot.js';
import { observationDigest } from '../snapshot/observationDigest.js';
import { captureFrames } from './captureFrames.js';
import { evaluateCheckpoint } from './evaluateCheckpoint.js';
import type { NavigationTracker } from './NavigationTracker.js';

type AriaRole = Parameters<Frame['getByRole']>[0];

/** What `WebSurface` is built from (by `launchWebSurface` / `openWebSurface`): the page, origin, clock, dialog monitor and navigation tracker. */
export interface WebSurfaceDeps {
	readonly page: Page;
	readonly origin: string;
	readonly clock: Clock;
	readonly dialogs: DialogMonitor;
	readonly navigation: NavigationTracker;
	/** Row headers whose value cells screenshots mask (default `DEFAULT_SENSITIVE_ROW_HEADERS`). */
	readonly sensitiveRowHeaders?: readonly string[];
	/** Closes everything the surface owns (context, and the browser when it launched it). */
	readonly close: () => Promise<void>;
}

const DEFAULT_MAX_TEXT = 20_000;
const SNAPSHOT_TIMEOUT_MS = 5_000;
const POLL_MS = 100;

/** The Playwright web adapter behind the `Surface` port. Browser objects never leave this class. */
export class WebSurface implements Surface {
	private readonly ladder: LadderResolver<Frame, Locator>;
	private refs = new Map<string, RefTarget>();
	private closed = false;

	constructor(private readonly deps: WebSurfaceDeps) {
		this.ladder = new LadderResolver<Frame, Locator>({
			root: () => this.deps.page.mainFrame(),
			toLocator: rungToLocator,
		});
		deps.page.on('close', () => {
			this.closed = true;
		});
	}

	private assertOpen(): void {
		if (this.closed || this.deps.page.isClosed()) throw new SurfaceClosedError();
	}

	async observe(opts: ObserveOptions = {}): Promise<Observation> {
		this.assertOpen();
		const pendingDialog = this.deps.dialogs.current();
		const { snapshots, infos } = await captureFrames(this.deps.page, this.deps.navigation, {
			maxTextChars: opts.maxTextChars ?? DEFAULT_MAX_TEXT,
			snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
			// A native dialog blocks the page's script: observe without touching the DOM.
			domAccess: pendingDialog === null,
		});
		const { tree, refs } = buildA11yTree(snapshots);
		this.refs = refs;
		const top = infos[0];
		const url = this.deps.page.url();
		const title = top?.title ?? '';
		return {
			url,
			title,
			frames: infos,
			tree,
			pendingDialog,
			lastNavigation: this.deps.navigation.lastNavigation(),
			digest: observationDigest({ url, title, frames: infos, tree, pendingDialog }),
		};
	}

	private resolveLadder(target: TargetRef, bindings: Bindings): Promise<LadderMatch<Frame, Locator>> {
		return this.ladder.resolve(target, bindings);
	}

	/** Resolves a TargetRef ladder or an observation ref to one element (the seam executors use). */
	private async resolveTarget(target: ActionTarget, bindings: Bindings): Promise<ResolvedTarget> {
		if (target.kind === 'target') {
			const match = await this.resolveLadder(target.target, bindings);
			return {
				frame: match.frame,
				locator: match.locator,
				resolution: { rungIndex: match.rungIndex, rungKind: match.rungKind },
			};
		}
		const entry = this.refs.get(target.ref);
		const frame = entry === undefined ? null : frameAtPath(this.deps.page.mainFrame(), entry.framePath);
		if (entry === undefined || frame === null) throw new UnknownRefError(target.ref);
		return { frame, locator: frame.getByRole(entry.role as AriaRole).nth(entry.nth) };
	}

	async resolve(target: TargetRef, bindings: Bindings = {}): Promise<Resolution> {
		this.assertOpen();
		const match = await this.resolveLadder(target, bindings);
		const fingerprint = await fingerprintElement(match.frame, match.locator);
		return { rungIndex: match.rungIndex, rungKind: match.rungKind, fingerprint };
	}

	async act(action: SurfaceAction): Promise<ActOutcome> {
		this.assertOpen();
		const context: ActionContext = {
			page: this.deps.page,
			origin: this.deps.origin,
			dialogs: this.deps.dialogs,
			navigation: this.deps.navigation,
			resolveTarget: (target, bindings) => this.resolveTarget(target, bindings),
			check: (checkpoint, bindings, timeoutMs) => this.check(checkpoint, bindings, timeoutMs),
		};
		return executeAction(context, action);
	}

	async check(checkpoint: Checkpoint, bindings: Bindings, timeoutMs: number): Promise<CheckResult> {
		this.assertOpen();
		const deadline = this.deps.clock.now().getTime() + timeoutMs;
		for (;;) {
			const dialog = this.deps.dialogs.current();
			const result: CheckResult =
				dialog === null
					? await evaluateCheckpoint(
							{ page: this.deps.page, resolve: (target, b) => this.resolveLadder(target, b) },
							checkpoint,
							bindings,
						)
					: { kind: 'not_held', observed: `a native ${dialog.type} dialog is pending` };
			if (result.kind === 'held' || this.deps.clock.now().getTime() >= deadline) return result;
			await new Promise((resolve) => setTimeout(resolve, POLL_MS));
			this.assertOpen();
		}
	}

	async describe(target: ActionTarget, bindings: Bindings = {}): Promise<ElementFingerprint> {
		this.assertOpen();
		const resolved = await this.resolveTarget(target, bindings);
		return fingerprintElement(resolved.frame, resolved.locator);
	}

	async captureEvidence(redactor: Redactor): Promise<EvidenceCapture> {
		this.assertOpen();
		// A native dialog blocks the page's script, so the sensitive elements could not be found and masked.
		this.deps.dialogs.assertNone('capture_evidence');
		const observation = await this.observe();
		const screenshot = await captureMaskedScreenshot(
			this.deps.page,
			redactor,
			this.deps.sensitiveRowHeaders === undefined ? {} : { sensitiveRowHeaders: this.deps.sensitiveRowHeaders },
		);
		return {
			screenshot,
			a11yTree: redactor.redact(observation.tree),
			url: redactor.redactString(observation.url),
		};
	}

	async location(): Promise<SurfaceLocation> {
		this.assertOpen();
		const domAccess = this.deps.dialogs.current() === null;
		const frames = await Promise.all(
			this.deps.page
				.frames()
				.filter((frame) => !frame.isDetached())
				.map(async (frame) => ({
					path: framePathOf(frame),
					name: frame.name(),
					url: frame.url(),
					title: domAccess ? await frame.title().catch(() => '') : '',
				})),
		);
		return { url: this.deps.page.url(), title: frames[0]?.title ?? '', frames };
	}

	pendingDialog(): PendingDialog | null {
		return this.deps.dialogs.current();
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		await this.deps.close();
	}
}
