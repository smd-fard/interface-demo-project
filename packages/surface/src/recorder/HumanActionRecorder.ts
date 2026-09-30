import { randomUUID } from 'node:crypto';
import { systemClock, type Clock } from '@idp/evidence';
import type { Disposable, Frame, Locator, Page, Request } from 'playwright';
import { ApprovalRequiredError } from '../errors/ApprovalRequiredError.js';
import { NoDialogPendingError } from '../errors/NoDialogPendingError.js';
import { PolicyDeniedError } from '../errors/PolicyDeniedError.js';
import { RecorderStateError } from '../errors/RecorderStateError.js';
import type { PolicyGuardedSurface } from '../guard/PolicyGuardedSurface.js';
import { isGoneFrameError } from '../internal/isGoneFrameError.js';
import { fingerprintElement } from '../locators/fingerprintElement.js';
import { LadderResolver } from '../locators/LadderResolver.js';
import { rungToLocator } from '../locators/rungToLocator.js';
import { browserInternals } from '../playwright/BrowserHandle.js';
import { blockedOriginOf, type NavigationDecision } from '../playwright/networkGuard.js';
import type { BrowserHandle } from '../port/BrowserHandle.js';
import type { SurfaceAction } from '../port/SurfaceAction.js';
import {
	commandCaptureScript,
	installCaptureScript,
	passCaptureScript,
	TOKEN_ATTRIBUTE,
	type CaptureCommand,
	type CaptureConfig,
	type CaptureMode,
	type PassKind,
} from './captureScript.js';
import type { DomEventDescriptor } from './DomEventDescriptor.js';
import { mapDomEventToStep, type RecordedGesture } from './mapDomEventToStep.js';
import type { RecordedHumanAction } from './RecordedHumanAction.js';
import { showRefusalBanner } from './showRefusalBanner.js';
import { targetFromFingerprint } from './targetFromFingerprint.js';

/** Receives each recorded human action, in order. `value` of a fill is sensitive: redact before any sink. */
export type RecordListener = (action: RecordedHumanAction) => void;

/** Options for `HumanActionRecorder`: an injectable clock, the refusal-banner duration and an error sink. */
export interface HumanActionRecorderOptions {
	readonly clock?: Clock;
	/** How long the in-page refusal banner stays (default 4 000 ms). */
	readonly bannerMs?: number;
	/**
	 * Receives unexpected errors while processing a gesture (the browser went away, a listener threw). When
	 * omitted they are kept in `errors`. Never swallowed.
	 */
	readonly onError?: (error: unknown) => void;
	/**
	 * Whether a native dialog blocks the page's script right now (then no frame can be evaluated). Default: the
	 * recording guard's `pendingDialog()`, or false while not recording. The live session passes the surface's.
	 */
	readonly dialogPending?: () => boolean;
}

/** The banner shown when the page is locked and a person touches it (see `lock`). */
export const DEFAULT_BLOCK_MESSAGE =
	'Automation is in control of this window (or it is waiting for an operator decision): your input was blocked. ' +
	'Take control from the operator console first.';

type Recordable = Omit<RecordedHumanAction, 'seq' | 'at'>;

interface Active {
	readonly guard: PolicyGuardedSurface;
	readonly onRecorded: RecordListener;
	readonly page: Page;
	/** The exposed binding's (random) name. */
	readonly bindingName: string;
	readonly binding: Disposable;
	readonly onRequestFailed: (request: Request) => void;
}

const newSecret = () => randomUUID().replaceAll('-', '');

const TOKEN = /^[\w-]{1,64}$/;

function typedCode(error: unknown): string | undefined {
	const code = error instanceof Error ? (error as { code?: unknown }).code : undefined;
	return typeof code === 'string' ? code : undefined;
}

/**
 * Mediated control during a handoff (R6.2): the human works in the same live browser, but every gesture goes
 * through the policy like any other actor (invariant 2). A capture script in every frame blocks each click,
 * Enter and submit before the page sees it and reports it (with `change` on fields, which is not blocked).
 * For each gesture the recorder fingerprints the element, builds a locator ladder from it (checked to resolve
 * that very element) and re-executes the action through the policy-guarded surface with actor `human`:
 * allowed → performed once and recorded (`refused: false`); denied or needing approval → not performed,
 * recorded as refused, and an in-page banner says so. A human cannot bypass an approval by clicking: an
 * irreversible click is recorded as refused with verdict `require_approval`.
 *
 * The re-execution gets through the capture script by a pass: set through the document's secret-checked
 * capture control (the secret is random per recording; nothing in the DOM marks the element), only after the
 * policy allowed the action, valid for exactly the one event the re-execution dispatches, and cleared as soon
 * as the re-execution ends (or, when a native dialog blocks the page, once it is settled).
 *
 * Not interceptable as DOM gestures: `navigate` (the address bar is outside the page: the network guard
 * blocks off-allowlist origins, each recorded as a refused `navigate` with the origin; every other document
 * request that no guarded act started is checked by the policy through the network guard's navigation hook —
 * denied or irreversible → aborted and recorded as a refused `navigate`, allowed top-level ones recorded as an
 * allowed `navigate`, both with the URL as a sensitive value), `extract` and `wait` (reading and waiting are
 * not actions on the page), and `dismiss_dialog` (a native dialog is held by the surface, outside the page:
 * the operator settles it with `settleDialog`, recorded as `dismiss_dialog`).
 *
 * Locked page (`lock`, attended sessions): between recordings — while the automation holds the lease or the
 * session waits for an operator — the capture script stays installed in `block` mode, so a person at a headed
 * browser cannot click, type, select or submit anything unmediated (e.g. an irreversible Confirm while its
 * approval is pending). The automation's own input gets through only inside `automationAct`, which the live
 * session wraps around each policy-allowed automation act.
 */
export class HumanActionRecorder {
	/** Unexpected processing errors, when no `onError` is given. */
	readonly errors: unknown[] = [];
	private active: Active | null = null;
	private queue: Promise<void> = Promise.resolve();
	private seq = 0;
	private readonly stateKey = `__idpCapture_${randomUUID().replaceAll('-', '')}`;
	private readonly clock: Clock;
	/** The current secret of the capture controls (rotated by `lock` and `start`). */
	private secret = newSecret();
	/** The secret before the last rotation: documents still keyed with it are re-keyed. */
	private previousSecret: string | null = null;
	/** Frames whose pass could not be cleared while a dialog blocked the page; cleared once it is settled. */
	private readonly staleFrames: Frame[] = [];
	/** `lock`: the page is in `block` mode whenever it is not recording. */
	private locked = false;
	private blockMessage = DEFAULT_BLOCK_MESSAGE;
	/** Automation acts in progress (`automationAct`). */
	private automationDepth = 0;
	/** The one registered init script (the capture script for new documents, with the current config). */
	private initScript: Disposable | null = null;
	/** Page reconfigurations, serialized. */
	private configQueue: Promise<void> = Promise.resolve();
	/** The open documents missed a reconfiguration because a native dialog blocked them; retried until applied. */
	private staleTimer: NodeJS.Timeout | null = null;

	constructor(
		private readonly handle: BrowserHandle,
		private readonly options: HumanActionRecorderOptions = {},
	) {
		this.clock = options.clock ?? systemClock;
	}

	get recording(): boolean {
		return this.active !== null;
	}

	/** Whether the page is locked between recordings (`lock`). */
	get isLocked(): boolean {
		return this.locked;
	}

	/**
	 * Locks the page for the rest of the session: whenever the recorder is not recording, the capture script runs
	 * in `block` mode in every frame (current and future) and blocks every trusted gesture with a banner. Use
	 * `automationAct` around the automation's own acts. Idempotent.
	 */
	async lock(options: { readonly message?: string } = {}): Promise<void> {
		this.locked = true;
		if (options.message !== undefined) this.blockMessage = options.message;
		await this.reconfigure(true);
	}

	/**
	 * Runs one automation act on a locked page: the page lets input through while it runs (the session calls this
	 * only after the policy allowed the act). Not locked, or recording (the lease keeps the automation out then):
	 * just runs it.
	 */
	async automationAct<T>(run: () => Promise<T>): Promise<T> {
		if (!this.locked || this.active !== null || this.handle.closed) return run();
		this.automationDepth += 1;
		try {
			if (this.automationDepth === 1) await this.reconfigure(false);
			return await run();
		} finally {
			this.automationDepth -= 1;
			if (this.automationDepth === 0) await this.reconfigure(false);
		}
	}

	/** Starts mediating: the capture script records in every frame (current and future). */
	async start(guard: PolicyGuardedSurface, onRecorded: RecordListener): Promise<void> {
		if (this.active !== null) throw new RecorderStateError('already_recording');
		const { context, page, networkGuard } = browserInternals(this.handle);
		const bindingName = `__idpRecord_${newSecret()}`;
		const binding = await context.exposeBinding(bindingName, (source: { frame: Frame }, descriptor: unknown) => {
			this.enqueue(() => this.onGesture(source.frame, descriptor as DomEventDescriptor));
		});
		const onRequestFailed = (request: Request) => {
			if (request.isNavigationRequest() && (request.failure()?.errorText ?? '').includes('ERR_BLOCKED_BY_CLIENT')) {
				this.enqueue(() => this.onBlockedNavigation(request.url()));
			}
		};
		page.on('requestfailed', onRequestFailed);
		const active: Active = { guard, onRecorded, page, bindingName, binding, onRequestFailed };
		this.active = active;
		networkGuard.setNavigationHook((request) => this.onNavigationRequest(active, request));
		await this.reconfigure(true);
	}

	/**
	 * Stops mediating: the capture script goes back to `block` (locked) or inert in every frame; waits for
	 * gestures in flight.
	 */
	async stop(): Promise<void> {
		const active = this.active;
		if (active === null) return;
		this.active = null;
		browserInternals(this.handle).networkGuard.setNavigationHook(null);
		active.page.off('requestfailed', active.onRequestFailed);
		// Reconfiguring also drops any pass left in the document.
		await this.reconfigure(false);
		await this.queue;
		this.staleFrames.splice(0);
		if (!this.handle.closed) {
			await active.binding.dispose();
			await this.inEveryFrame(active.page, (frame) =>
				frame.evaluate((attribute) => {
					for (const el of document.querySelectorAll(`[${attribute}]`)) el.removeAttribute(attribute);
				}, TOKEN_ATTRIBUTE),
			);
		}
	}

	/** The capture mode the page should be in now. */
	private mode(): CaptureMode {
		if (this.active !== null) return 'record';
		return this.locked ? 'block' : 'off';
	}

	private dialogPending(): boolean {
		if (this.options.dialogPending !== undefined) return this.options.dialogPending();
		return this.active !== null && this.active.guard.pendingDialog() !== null;
	}

	/**
	 * Applies the current mode to new documents (one init script, replaced) and to every open frame. Serialized.
	 * While a native dialog blocks the page's script the open frames are retried until the dialog is gone.
	 */
	private reconfigure(rotate: boolean): Promise<void> {
		const task = this.configQueue.then(() => this.applyConfig(rotate));
		this.configQueue = task.catch(() => undefined);
		return task;
	}

	private async applyConfig(rotate: boolean): Promise<void> {
		if (this.handle.closed) return;
		if (rotate) {
			this.previousSecret = this.secret;
			this.secret = newSecret();
		}
		const config = this.config();
		const { context, page } = browserInternals(this.handle);
		const previous = this.initScript;
		// Registered before the old one goes: a document starting in between runs both, the newer config last.
		this.initScript = config.mode === 'off' ? null : await context.addInitScript(installCaptureScript, config);
		await previous?.dispose();
		if (this.dialogPending()) {
			this.retryWhenDialogGone();
			return;
		}
		await this.inEveryFrame(page, (frame) => frame.evaluate(installCaptureScript, config));
	}

	private config(): CaptureConfig {
		return {
			binding: this.active?.bindingName ?? '',
			stateKey: this.stateKey,
			secret: this.secret,
			previousSecret: this.previousSecret,
			mode: this.mode(),
			automation: this.automationDepth > 0,
			blockMessage: this.blockMessage,
			tokenAttribute: TOKEN_ATTRIBUTE,
		};
	}

	private retryWhenDialogGone(): void {
		if (this.staleTimer !== null) return;
		this.staleTimer = setInterval(() => {
			if (this.handle.closed) {
				this.clearStaleTimer();
				return;
			}
			if (this.dialogPending()) return;
			this.clearStaleTimer();
			void this.reconfigure(false).catch((error: unknown) => this.report(error));
		}, 100);
		this.staleTimer.unref();
	}

	private clearStaleTimer(): void {
		if (this.staleTimer === null) return;
		clearInterval(this.staleTimer);
		this.staleTimer = null;
	}

	private report(error: unknown): void {
		if (this.options.onError !== undefined) this.options.onError(error);
		else this.errors.push(error);
	}

	/**
	 * The operator settles the pending native dialog (OK = `accept`, Cancel = `dismiss`). It goes through the
	 * guard as `dismiss_dialog` (actor `human`) and is recorded like any gesture.
	 */
	settleDialog(action: 'accept' | 'dismiss'): Promise<RecordedHumanAction> {
		const active = this.active;
		if (active === null) return Promise.reject(new RecorderStateError('not_recording'));
		const task = this.queue.then(async () => {
			const dialog = active.guard.pendingDialog();
			if (dialog === null) throw new NoDialogPendingError('(operator)');
			const record = await this.perform(
				active,
				{ kind: 'dismiss_dialog', fingerprint: null, value: action, sensitive: false, verdict: null, refused: true },
				() => active.guard.act({ kind: 'dismiss_dialog', actor: 'human', match: dialog.message, action }),
			);
			if (active.guard.pendingDialog() === null) await this.clearStaleMarks();
			return record;
		});
		this.queue = task.then(
			() => undefined,
			() => undefined,
		);
		return task;
	}

	private enqueue(task: () => Promise<void>): void {
		this.queue = this.queue.then(task).catch((error: unknown) => this.report(error));
	}

	private async inEveryFrame(page: Page, run: (frame: Frame) => Promise<unknown>): Promise<void> {
		for (const frame of page.frames()) {
			if (frame.isDetached()) continue;
			try {
				await run(frame);
			} catch (error) {
				if (!isGoneFrameError(error)) throw error;
			}
		}
	}

	private emit(active: Active, recordable: Recordable): RecordedHumanAction {
		this.seq += 1;
		const record: RecordedHumanAction = { seq: this.seq, ...recordable, at: this.clock.now().toISOString() };
		active.onRecorded(record);
		return record;
	}

	/**
	 * The network guard's navigation hook while recording: a document request to an allowed origin that no
	 * guarded act started (the address bar, a script) is checked by the policy as a human `navigate`. Denied or
	 * needing approval → aborted, recorded as refused; allowed → let through, recorded when it is top-level (a
	 * frame loading inside an allowed page is not an action of its own). Synchronous: never waits for the queue.
	 */
	private onNavigationRequest(active: Active, request: Request): NavigationDecision {
		// Stopped, or a navigation of an act the guard already checked (a mediated re-execution).
		if (this.active !== active || active.guard.acting) return 'continue';
		const url = request.url();
		if (!url.startsWith('http:') && !url.startsWith('https:')) return 'continue';
		const frame = request.frame();
		const currentUrl = frame.url() !== '' && !frame.url().startsWith('about:') ? frame.url() : active.page.url();
		const verdict = active.guard.checkNavigation(url, currentUrl, 'human');
		const base: Recordable = {
			kind: 'navigate',
			fingerprint: null,
			value: url,
			sensitive: true,
			verdict: null,
			refused: true,
		};
		if (verdict.kind === 'allow') {
			if (frame.parentFrame() === null) {
				this.enqueue(async () => {
					this.emit(active, { ...base, verdict: 'allow', refused: false });
				});
			}
			return 'continue';
		}
		this.enqueue(async () => {
			this.emit(
				active,
				verdict.kind === 'deny'
					? { ...base, verdict: 'deny', denyCode: verdict.code }
					: { ...base, verdict: 'require_approval' },
			);
		});
		return 'abort';
	}

	private async onBlockedNavigation(url: string): Promise<void> {
		const active = this.active;
		if (active === null) return;
		this.emit(active, {
			kind: 'navigate',
			fingerprint: null,
			value: blockedOriginOf(url),
			sensitive: false,
			verdict: 'deny',
			refused: true,
			denyCode: 'origin_not_allowed',
		});
	}

	private async onGesture(frame: Frame, descriptor: DomEventDescriptor): Promise<void> {
		const active = this.active;
		// Stopped meanwhile (the gesture stays blocked), or a descriptor the capture script did not write.
		if (active === null || typeof descriptor?.token !== 'string' || !TOKEN.test(descriptor.token)) return;
		if (active.guard.pendingDialog() === null) await this.clearStaleMarks();
		if (active.guard.pendingDialog() !== null) {
			// A native dialog blocks the page's script: the element cannot be inspected, so nothing is performed.
			this.emit(active, {
				kind: descriptor.event === 'change' ? 'fill' : 'click',
				fingerprint: null,
				sensitive: descriptor.event === 'change',
				verdict: null,
				refused: true,
				errorCode: 'DIALOG_PENDING',
			});
			return;
		}
		const element = frame.locator(`[${TOKEN_ATTRIBUTE}="${descriptor.token}"]`);
		if ((await element.count()) !== 1) return;
		const fingerprint = await fingerprintElement(frame, element);
		const gesture = mapDomEventToStep(descriptor, fingerprint);
		if (gesture === null) return;

		const base: Recordable = {
			kind: gesture.kind,
			fingerprint,
			...(gesture.value === undefined ? {} : { value: gesture.value }),
			sensitive: gesture.sensitive,
			verdict: null,
			refused: true,
		};
		const target = targetFromFingerprint(fingerprint);
		const same =
			target !== null &&
			(await this.ladderFor(active.page)
				.resolve(target, {})
				.then((match) =>
					match.locator.evaluate((el, mark) => el.getAttribute(mark.attr) === mark.token, {
						attr: TOKEN_ATTRIBUTE,
						token: descriptor.token,
					}),
				)
				.catch((error: unknown) => {
					if (typedCode(error) !== undefined) return false;
					throw error;
				}));
		const valued = gesture.kind === 'fill' || gesture.kind === 'select';
		if (target === null || !same) {
			const record = this.emit(active, { ...base, errorCode: 'TARGET_NOT_REPLAYABLE' });
			if (valued) await this.settleValue(element, record);
			return;
		}

		const action = toAction(gesture, target);
		let passed = false;
		let record: RecordedHumanAction;
		try {
			record = await this.perform(
				active,
				base,
				() =>
					active.guard.actWith(action, {
						// Only after the policy allowed it: one pass, for the one event this re-execution dispatches.
						beforeInnerAct: async () => {
							passed = true;
							await element.evaluate(passCaptureScript, {
								stateKey: this.stateKey,
								secret: this.secret,
								command: { op: 'pass' as const, kind: passKindOf(action.kind) },
							});
						},
					}),
				frame,
			);
		} finally {
			if (passed) await this.clearPass(active, frame);
		}
		if (valued) await this.settleValue(element, record);
	}

	/**
	 * After the verdict on a human fill or select: an accepted value becomes the one to revert to; a refused one
	 * is reverted in the page (the person's value never stays on screen unperformed). Skipped while a native
	 * dialog blocks the page, or when the element is gone.
	 */
	private async settleValue(element: Locator, record: RecordedHumanAction): Promise<void> {
		if (this.dialogPending()) return;
		try {
			await element.evaluate(passCaptureScript, {
				stateKey: this.stateKey,
				secret: this.secret,
				command: { op: 'settle' as const, accepted: !record.refused },
			});
		} catch (error) {
			if (!isGoneFrameError(error)) throw error;
		}
	}

	/** Runs the guarded action and records the verdict; refusals show the banner. */
	private async perform(
		active: Active,
		base: Recordable,
		run: () => Promise<unknown>,
		frame?: Frame,
	): Promise<RecordedHumanAction> {
		try {
			await run();
			return this.emit(active, { ...base, verdict: 'allow', refused: false });
		} catch (error) {
			if (error instanceof PolicyDeniedError) {
				const refused = error.stage === 'pre_action';
				if (refused) await this.banner(active, frame, `Refused by policy: ${error.denyCode}`);
				return this.emit(active, { ...base, verdict: 'deny', refused, denyCode: error.denyCode });
			}
			if (error instanceof ApprovalRequiredError) {
				await this.banner(active, frame, 'Refused by policy: approval required (irreversible action)');
				return this.emit(active, { ...base, verdict: 'require_approval', refused: true });
			}
			const code = typedCode(error);
			if (code === undefined) throw error;
			return this.emit(active, { ...base, verdict: null, refused: true, errorCode: code });
		}
	}

	private async banner(active: Active, frame: Frame | undefined, text: string): Promise<void> {
		if (active.guard.pendingDialog() !== null) return;
		const where = frame !== undefined && !frame.isDetached() ? frame : active.page.mainFrame();
		try {
			await where.evaluate(showRefusalBanner, { text, ms: this.options.bannerMs ?? 4_000 });
		} catch (error) {
			if (!isGoneFrameError(error)) throw error;
		}
	}

	/** Sends a command to the capture control of one frame (ignored when its document has none). */
	private async command(frame: Frame, command: CaptureCommand): Promise<void> {
		await frame.evaluate(commandCaptureScript, { stateKey: this.stateKey, secret: this.secret, command });
	}

	/** Drops what is left of a pass. While a native dialog blocks the page's script, deferred until it is settled. */
	private async clearPass(active: Active, frame: Frame): Promise<void> {
		if (active.guard.pendingDialog() !== null) {
			this.staleFrames.push(frame);
			return;
		}
		await this.clearIn(frame);
	}

	private async clearStaleMarks(): Promise<void> {
		for (const frame of this.staleFrames.splice(0)) await this.clearIn(frame);
	}

	private async clearIn(frame: Frame): Promise<void> {
		if (frame.isDetached()) return;
		try {
			await this.command(frame, { op: 'clear' });
		} catch (error) {
			if (!isGoneFrameError(error)) throw error;
		}
	}

	private ladderFor(page: Page): LadderResolver<Frame, Locator> {
		return new LadderResolver<Frame, Locator>({ root: () => page.mainFrame(), toLocator: rungToLocator });
	}
}

/** The one event a re-execution of this kind dispatches on its element. */
function passKindOf(kind: SurfaceAction['kind']): PassKind {
	if (kind === 'click') return 'click';
	if (kind === 'press') return 'keydown';
	return 'change';
}

function toAction(
	gesture: RecordedGesture,
	target: NonNullable<ReturnType<typeof targetFromFingerprint>>,
): SurfaceAction {
	const on = { kind: 'target' as const, target };
	switch (gesture.kind) {
		case 'click':
			return { kind: 'click', actor: 'human', target: on };
		case 'fill':
			return { kind: 'fill', actor: 'human', target: on, value: gesture.value ?? '', sensitive: true };
		case 'select':
			return { kind: 'select', actor: 'human', target: on, option: gesture.value ?? '' };
		case 'press':
			return { kind: 'press', actor: 'human', target: on, key: 'Enter' };
	}
}
