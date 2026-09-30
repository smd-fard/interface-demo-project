import type { DomEventDescriptor } from './DomEventDescriptor.js';

/** Marks the element a human touched, so the recorder can find it in the reporting frame. */
export const TOKEN_ATTRIBUTE = 'data-idp-rec';
/**
 * The event a pass lets through: the one the guarded surface's re-execution dispatches (`click` for a click,
 * `keydown` for a press, `change` for a fill or select).
 */
export type PassKind = 'click' | 'keydown' | 'change';

/**
 * What the capture script does in a document:
 * - `off`: inert (unattended sessions, or after the recorder is released).
 * - `block`: the lease is not `HUMAN` (`AGENT`, `PAUSED`, `RESUMING`) in an attended session. Every trusted user
 *   gesture (pointer, click, key, input, change, paste, drop — hence every submit a person can cause) is blocked before the page sees it, nothing
 *   is reported, and an in-page banner says automation is in control. The automation's own (trusted) Playwright
 *   input gets through only while `automation` is on: the session turns it on around each policy-allowed
 *   automation act.
 * - `record`: the lease is `HUMAN`: gestures are blocked, reported and re-executed through the policy guard.
 */
export type CaptureMode = 'off' | 'block' | 'record';

/** A command to the in-page capture control. Every command must carry the current secret. */
export type CaptureCommand =
	| {
			readonly op: 'configure';
			readonly mode: CaptureMode;
			readonly binding: string;
			readonly secret: string;
			readonly automation: boolean;
			readonly blockMessage: string;
	  }
	| { readonly op: 'disable' }
	| { readonly op: 'pass'; readonly kind: PassKind }
	| { readonly op: 'clear' }
	/**
	 * After the policy verdict on a human fill/select of `element`: accepted → its value becomes the one a later
	 * refusal reverts to; refused → the control is put back to that value (the refused value never stays).
	 */
	| { readonly op: 'settle'; readonly accepted: boolean };

/**
 * The in-page control of one document's capture script, stored non-enumerable, non-writable and
 * non-configurable at `window[stateKey]`. It returns `false` (and does nothing) unless `secret` is the
 * current secret, so page script can neither switch mediation off nor grant itself a pass.
 */
export type CaptureControl = (secret: string, command: CaptureCommand, element?: Element) => boolean;

/** What the capture script needs in each document. */
export interface CaptureConfig {
	/** The exposed binding that receives descriptors (randomized per recording; unused unless `record`). */
	readonly binding: string;
	/** The window property holding the document's capture control (randomized per recorder). */
	readonly stateKey: string;
	/** Randomized by the recorder; never a constant the page could know. */
	readonly secret: string;
	/** The previous secret: documents still keyed with it are re-keyed. */
	readonly previousSecret: string | null;
	readonly mode: CaptureMode;
	/** `block` only: an automation act is in progress, so input is let through. */
	readonly automation: boolean;
	/** `block` only: the banner shown when a gesture is blocked. */
	readonly blockMessage: string;
	readonly tokenAttribute: string;
}

/**
 * The capture script, run in every frame (`context.addInitScript` for new documents, `frame.evaluate` for
 * the ones already open). Self-contained: it is serialized into the page. Its state lives in a closure; the
 * only handle on it is the secret-checked control at `window[stateKey]`. Running it again in a document that
 * already has it re-keys and reconfigures it; while `off` it is inert, so automation is unaffected.
 *
 * In `block` mode (see `CaptureMode`) every trusted gesture is blocked in the capture phase and a banner shows;
 * script-dispatched (untrusted) events are left alone: they are the page's own behaviour, not a person's.
 *
 * In `record` mode it listens in the capture phase on `window`, so it runs before the page's own handlers
 * (including legacy inline `onclick="return window.confirm(…)"`):
 * - `click` on an actionable element (link, button, submit/button/image/reset/checkbox/radio input,
 *   `role=button|link`, `[onclick]`), Enter `keydown` on a control, and `submit` are blocked
 *   (`preventDefault` + `stopImmediatePropagation`) and reported; the recorder re-executes the allowed ones
 *   through the guarded surface.
 * - `change` on a `<select>` is stopped before the page's handlers (a legacy `onchange` submit never runs before
 *   the policy verdict) and reported; the recorder re-executes an allowed select through the guard, whose
 *   passed `change` is the only one the page sees. `change` on a text field is reported without blocking (the
 *   typed text is already there). A refused fill or select is reverted (`settle`) to the value the control had
 *   when it was focused (or last accepted). Enter or a click first flushes an edited field whose `change` has
 *   not fired yet, so the fill is recorded before the gesture that submits it. A value is reported once
 *   (re-typing the same value, or the re-executed fill, is not reported again).
 * - A pass (set by the recorder through the control, only after the policy allowed the re-execution) lets
 *   exactly one event of its kind on that element through (trusted `click` / `keydown`, or `change`) and is
 *   consumed by it. The events that one event causes are let through once each, scoped to it: the `submit`
 *   of the form a passed submit button or Enter submits, and the click Enter synthesizes on the element or
 *   on its form's default button. Nothing else is exempt — a whole form is never exempt because a passed
 *   field is inside it. The recorder clears whatever is left (`clear`) as soon as the re-execution ends.
 */
export const installCaptureScript = (config: CaptureConfig): void => {
	type Control = (secret: string, command: CaptureCommand, element?: Element) => boolean;
	const host = window as unknown as Record<string, unknown>;
	const existing = host[config.stateKey];
	if (typeof existing === 'function') {
		const control = existing as Control;
		const command: CaptureCommand = {
			op: 'configure',
			mode: config.mode,
			binding: config.binding,
			secret: config.secret,
			automation: config.automation,
			blockMessage: config.blockMessage,
		};
		if (!control(config.secret, command) && config.previousSecret !== null) control(config.previousSecret, command);
		return;
	}
	// Nothing to switch off in a document that never had the script.
	if (existing !== undefined || config.mode === 'off') return;

	let mode: CaptureMode = config.mode;
	let automation = config.automation;
	let blockMessage = config.blockMessage;
	let binding = config.binding;
	let secret = config.secret;
	let next = 0;
	let bannerAt = 0;
	let pass: { readonly el: Element; readonly kind: PassKind } | null = null;
	let follow: { readonly el: Element; readonly form: HTMLFormElement | null; click: boolean; submit: boolean } | null =
		null;
	const reported = new WeakMap<Element, string>();
	/** The value a refused fill/select reverts to: taken on focus, updated when a value is accepted. */
	const prior = new WeakMap<Element, string>();

	const NOT_TYPED = ['checkbox', 'radio', 'file', 'submit', 'button', 'image', 'reset', 'hidden'];
	const ACTIONABLE =
		'a[href], button, input[type=submit i], input[type=button i], input[type=image i], input[type=reset i], ' +
		'input[type=checkbox i], input[type=radio i], [role=button], [role=link], [onclick]';
	const CONTROL = 'input, select, button, a[href], [role=button], [role=link]';
	const BLOCKED_IN_BLOCK_MODE = [
		'pointerdown',
		'pointerup',
		'mousedown',
		'mouseup',
		'click',
		'dblclick',
		'auxclick',
		'contextmenu',
		'keydown',
		'keypress',
		'keyup',
		'beforeinput',
		'input',
		'change',
		'paste',
		'cut',
		'drop',
		'dragstart',
	];
	// `submit` is not in the list: a person submits only by a click or Enter (both blocked), while the submit event
	// of a script's `requestSubmit()` is trusted too and belongs to the page's own behaviour.
	/** The events a person starts a gesture with: the banner is shown for these (not for every key-up). */
	const GESTURE_STARTS = ['mousedown', 'keydown', 'paste', 'drop'];

	const inputType = (el: Element) =>
		el.tagName === 'INPUT' ? (el.getAttribute('type') ?? 'text').toLowerCase() : null;
	const isTextField = (el: Element): el is HTMLInputElement | HTMLTextAreaElement =>
		el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !NOT_TYPED.includes(inputType(el) ?? 'text'));
	const isSelect = (el: Element): el is HTMLSelectElement => el.tagName === 'SELECT';
	const formOf = (el: Element): HTMLFormElement | null => {
		const owner = (el as Partial<HTMLInputElement>).form;
		return owner instanceof HTMLFormElement ? owner : el.closest('form');
	};
	const isSubmitButton = (el: Element) =>
		(el.tagName === 'BUTTON' || el.tagName === 'INPUT') &&
		['submit', 'image'].includes((el as HTMLInputElement | HTMLButtonElement).type);
	/** The value a control reverts to when nothing better is known: its default (HTML) value. */
	const defaultValueOf = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => {
		if (!isSelect(el)) return el.defaultValue;
		const chosen = Array.from(el.options).find((option) => option.defaultSelected) ?? el.options[0];
		return chosen?.value ?? '';
	};
	const rememberPrior = (el: Element | null) => {
		if (el !== null && (isTextField(el) || isSelect(el))) prior.set(el, el.value);
	};

	const showBanner = () => {
		const now = Date.now();
		if (now - bannerAt < 500) return;
		bannerAt = now;
		const id = 'idp-refusal-banner';
		document.getElementById(id)?.remove();
		const banner = document.createElement('div');
		banner.id = id;
		banner.setAttribute('role', 'alert');
		banner.textContent = blockMessage;
		banner.style.cssText =
			'position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:6px 10px;background:#b00020;color:#fff;' +
			'font:bold 13px Arial,sans-serif;text-align:center;pointer-events:none';
		(document.body ?? document.documentElement).appendChild(banner);
		setTimeout(() => banner.remove(), 4_000);
	};

	/** Consumes the pass when this event is the one it was set for; then allows the events it causes, once each. */
	const takePass = (el: Element, kind: PassKind, event: Event): boolean => {
		const current = pass;
		if (current === null || current.kind !== kind || !current.el.contains(el)) return false;
		// A page script cannot forge a trusted click or key; the guarded surface's input is trusted.
		if (kind !== 'change' && !event.isTrusted) return false;
		pass = null;
		const form = formOf(current.el);
		follow =
			kind === 'change'
				? null
				: {
						el: current.el,
						form,
						click: kind === 'keydown',
						submit: form !== null && (kind === 'keydown' || isSubmitButton(current.el)),
					};
		return true;
	};
	const takeFollowClick = (el: Element) => {
		const current = follow;
		if (current === null || !current.click) return false;
		const own = current.el.contains(el);
		const defaultButton = current.form !== null && isSubmitButton(el) && formOf(el) === current.form;
		if (!own && !defaultButton) return false;
		current.click = false;
		return true;
	};
	const takeFollowSubmit = (form: HTMLFormElement) => {
		const current = follow;
		if (current === null || !current.submit || current.form !== form) return false;
		current.submit = false;
		return true;
	};

	const settle = (el: Element, accepted: boolean): boolean => {
		if (!isTextField(el) && !isSelect(el)) return false;
		if (accepted) {
			prior.set(el, el.value);
			return true;
		}
		const value = prior.get(el) ?? defaultValueOf(el);
		if (isSelect(el)) {
			// The page never saw the refused change (it was stopped), so it is not told about the revert either.
			el.value = value;
			return true;
		}
		reported.set(el, value);
		if (el.value !== value) {
			el.value = value;
			// The page saw the typed text (input events), so it learns the value is back. Untrusted: never reported.
			el.dispatchEvent(new Event('input', { bubbles: true }));
			el.dispatchEvent(new Event('change', { bubbles: true }));
		}
		return true;
	};

	const control: Control = (key, command, element) => {
		if (key !== secret) return false;
		switch (command.op) {
			case 'configure':
				mode = command.mode;
				binding = command.binding;
				secret = command.secret;
				automation = command.automation;
				blockMessage = command.blockMessage;
				pass = null;
				follow = null;
				if (mode === 'record') rememberPrior(document.activeElement);
				return true;
			case 'disable':
				mode = 'off';
				pass = null;
				follow = null;
				return true;
			case 'pass':
				if (!(element instanceof Element)) return false;
				pass = { el: element, kind: command.kind };
				follow = null;
				return true;
			case 'clear':
				pass = null;
				follow = null;
				return true;
			case 'settle':
				return element instanceof Element && settle(element, command.accepted);
		}
	};
	Object.defineProperty(window, config.stateKey, {
		value: control,
		enumerable: false,
		writable: false,
		configurable: false,
	});

	const tokenOf = (el: Element) => {
		let token = el.getAttribute(config.tokenAttribute);
		if (token === null) {
			next += 1;
			token = `${next}-${Math.random().toString(36).slice(2, 10)}`;
			el.setAttribute(config.tokenAttribute, token);
		}
		return token;
	};
	const send = (event: DomEventDescriptor['event'], el: Element, extra: Partial<DomEventDescriptor> = {}) => {
		const report = host[binding];
		if (typeof report !== 'function') return;
		const descriptor: DomEventDescriptor = {
			event,
			token: tokenOf(el),
			tag: el.tagName.toLowerCase(),
			inputType: inputType(el),
			...extra,
		};
		void (report as (d: DomEventDescriptor) => Promise<unknown>)(descriptor);
	};
	const block = (event: Event) => {
		event.preventDefault();
		event.stopImmediatePropagation();
	};
	const lastValue = (el: HTMLInputElement | HTMLTextAreaElement) => reported.get(el) ?? el.defaultValue;
	const reportValue = (el: HTMLInputElement | HTMLTextAreaElement) => {
		if (el.value === lastValue(el)) return;
		reported.set(el, el.value);
		send('change', el, { value: el.value });
	};
	const flush = (el: Element | null) => {
		const filling = pass !== null && pass.kind === 'change' && pass.el === el;
		if (el !== null && isTextField(el) && !filling) reportValue(el);
	};

	// Block mode: registered first, so it runs before the record-mode listeners and the page's own.
	for (const type of BLOCKED_IN_BLOCK_MODE) {
		window.addEventListener(
			type,
			(event) => {
				if (mode !== 'block' || automation || !event.isTrusted) return;
				block(event);
				const el = event.target;
				if (type === 'change' && el instanceof Element && (isTextField(el) || isSelect(el))) {
					el.value = prior.get(el) ?? defaultValueOf(el);
				}
				if (GESTURE_STARTS.includes(type)) showBanner();
			},
			true,
		);
	}
	window.addEventListener(
		'focusin',
		(event) => {
			if (mode === 'off' || !(event.target instanceof Element)) return;
			rememberPrior(event.target);
		},
		true,
	);

	window.addEventListener(
		'click',
		(event) => {
			if (mode !== 'record' || !(event.target instanceof Element)) return;
			const el = event.target.closest(ACTIONABLE);
			if (el === null || takePass(el, 'click', event) || takeFollowClick(el)) return;
			block(event);
			if (document.activeElement !== el) flush(document.activeElement);
			send('click', el);
		},
		true,
	);
	window.addEventListener(
		'keydown',
		(event) => {
			if (mode !== 'record' || event.key !== 'Enter' || !(event.target instanceof Element)) return;
			const el = event.target;
			if (el.tagName === 'TEXTAREA' || !el.matches(CONTROL) || takePass(el, 'keydown', event)) return;
			block(event);
			flush(el);
			send('keydown', el, { key: 'Enter' });
		},
		true,
	);
	window.addEventListener(
		'submit',
		(event) => {
			if (mode !== 'record' || !(event.target instanceof HTMLFormElement)) return;
			const form = event.target;
			if (takeFollowSubmit(form)) return;
			block(event);
			send('submit', (event as SubmitEvent).submitter ?? form);
		},
		true,
	);
	window.addEventListener(
		'input',
		(event) => {
			// A person's pick in a <select> fires input before change: the page sees neither before the verdict.
			if (mode !== 'record' || !event.isTrusted || !(event.target instanceof Element)) return;
			if (isSelect(event.target)) event.stopImmediatePropagation();
		},
		true,
	);
	window.addEventListener(
		'change',
		(event) => {
			if (mode !== 'record' || !(event.target instanceof Element)) return;
			const el = event.target;
			if (takePass(el, 'change', event)) {
				// The guarded surface's own fill or select: remember the value so a later blur is not reported.
				if (isTextField(el)) reported.set(el, el.value);
				rememberPrior(el);
				return;
			}
			if (isSelect(el)) {
				// Stopped before the page's handlers: a legacy onchange runs only for the policy-allowed re-execution.
				event.stopImmediatePropagation();
				send('change', el, { optionLabel: el.selectedOptions[0]?.label ?? '' });
				return;
			}
			if (isTextField(el)) reportValue(el);
		},
		true,
	);
};

/** The arguments of a command sent from the recorder. */
export interface CaptureCommandArgs {
	readonly stateKey: string;
	readonly secret: string;
	readonly command: CaptureCommand;
}

/**
 * Sends one command to the capture control of this document (`frame.evaluate`). Returns `false` when the
 * document has no capture script or the secret does not match.
 */
export const commandCaptureScript = (args: CaptureCommandArgs): boolean => {
	const control = (window as unknown as Record<string, unknown>)[args.stateKey];
	return typeof control === 'function' ? (control as CaptureControl)(args.secret, args.command) : false;
};

/**
 * Sends an element command (`pass`, `settle`) for this element (`locator.evaluate`). Returns `false` like
 * `commandCaptureScript`.
 */
export const passCaptureScript = (element: Element, args: CaptureCommandArgs): boolean => {
	const control = (element.ownerDocument.defaultView as unknown as Record<string, unknown> | null)?.[args.stateKey];
	return typeof control === 'function' ? (control as CaptureControl)(args.secret, args.command, element) : false;
};
