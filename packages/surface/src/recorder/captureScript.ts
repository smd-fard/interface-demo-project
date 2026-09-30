import type { DomEventDescriptor } from './DomEventDescriptor.js';

/** Marks the element a human touched, so the recorder can find it in the reporting frame. */
export const TOKEN_ATTRIBUTE = 'data-idp-rec';
/**
 * The event a pass lets through: the one the guarded surface's re-execution dispatches (`click` for a click,
 * `keydown` for a press, `change` for a fill or select).
 */
export type PassKind = 'click' | 'keydown' | 'change';

/** A command to the in-page capture control. Every command must carry the recording's secret. */
export type CaptureCommand =
	| { readonly op: 'enable'; readonly binding: string; readonly secret: string }
	| { readonly op: 'disable' }
	| { readonly op: 'pass'; readonly kind: PassKind }
	| { readonly op: 'clear' };

/**
 * The in-page control of one document's capture script, stored non-enumerable, non-writable and
 * non-configurable at `window[stateKey]`. It returns `false` (and does nothing) unless `secret` is the
 * recording's secret, so page script can neither switch mediation off nor grant itself a pass.
 */
export type CaptureControl = (secret: string, command: CaptureCommand, element?: Element) => boolean;

/** What the capture script needs in each document. */
export interface CaptureConfig {
	/** The exposed binding that receives descriptors (randomized per recording). */
	readonly binding: string;
	/** The window property holding the document's capture control (randomized per recorder). */
	readonly stateKey: string;
	/** Randomized per recording (`start`); never a constant the page could know. */
	readonly secret: string;
	/** The previous recording's secret: documents still keyed with it are re-keyed on `start`. */
	readonly previousSecret: string | null;
	readonly enabled: boolean;
	readonly tokenAttribute: string;
}

/**
 * The capture script, run in every frame (`context.addInitScript` for new documents, `frame.evaluate` for
 * the ones already open). Self-contained: it is serialized into the page. Its state lives in a closure; the
 * only handle on it is the secret-checked control at `window[stateKey]`. Running it again in a document that
 * already has it re-keys and enables it; while off it is inert, so automation is unaffected.
 *
 * While on, it listens in the capture phase on `window`, so it runs before the page's own handlers
 * (including legacy inline `onclick="return window.confirm(…)"`):
 * - `click` on an actionable element (link, button, submit/button/image/reset/checkbox/radio input,
 *   `role=button|link`, `[onclick]`), Enter `keydown` on a control, and `submit` are blocked
 *   (`preventDefault` + `stopImmediatePropagation`) and reported; the recorder re-executes the allowed ones
 *   through the guarded surface.
 * - `change` on a text field or select is reported without blocking (the value is already there).
 *   Enter or a click first flushes an edited field whose `change` has not fired yet, so the fill is
 *   recorded before the gesture that submits it. A value is reported once (re-typing the same value, or the
 *   re-executed fill, is not reported again).
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
		const command: CaptureCommand = config.enabled
			? { op: 'enable', binding: config.binding, secret: config.secret }
			: { op: 'disable' };
		if (!control(config.secret, command) && config.previousSecret !== null) control(config.previousSecret, command);
		return;
	}
	if (existing !== undefined) return;

	let enabled = config.enabled;
	let binding = config.binding;
	let secret = config.secret;
	let next = 0;
	let pass: { readonly el: Element; readonly kind: PassKind } | null = null;
	let follow: { readonly el: Element; readonly form: HTMLFormElement | null; click: boolean; submit: boolean } | null =
		null;
	const reported = new WeakMap<Element, string>();

	const NOT_TYPED = ['checkbox', 'radio', 'file', 'submit', 'button', 'image', 'reset', 'hidden'];
	const ACTIONABLE =
		'a[href], button, input[type=submit i], input[type=button i], input[type=image i], input[type=reset i], ' +
		'input[type=checkbox i], input[type=radio i], [role=button], [role=link], [onclick]';
	const CONTROL = 'input, select, button, a[href], [role=button], [role=link]';

	const inputType = (el: Element) =>
		el.tagName === 'INPUT' ? (el.getAttribute('type') ?? 'text').toLowerCase() : null;
	const isTextField = (el: Element): el is HTMLInputElement | HTMLTextAreaElement =>
		el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !NOT_TYPED.includes(inputType(el) ?? 'text'));
	const formOf = (el: Element): HTMLFormElement | null => {
		const owner = (el as Partial<HTMLInputElement>).form;
		return owner instanceof HTMLFormElement ? owner : el.closest('form');
	};
	const isSubmitButton = (el: Element) =>
		(el.tagName === 'BUTTON' || el.tagName === 'INPUT') &&
		['submit', 'image'].includes((el as HTMLInputElement | HTMLButtonElement).type);

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

	const control: Control = (key, command, element) => {
		if (key !== secret) return false;
		switch (command.op) {
			case 'enable':
				enabled = true;
				binding = command.binding;
				secret = command.secret;
				return true;
			case 'disable':
				enabled = false;
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

	window.addEventListener(
		'click',
		(event) => {
			if (!enabled || !(event.target instanceof Element)) return;
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
			if (!enabled || event.key !== 'Enter' || !(event.target instanceof Element)) return;
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
			if (!enabled || !(event.target instanceof HTMLFormElement)) return;
			const form = event.target;
			if (takeFollowSubmit(form)) return;
			block(event);
			send('submit', (event as SubmitEvent).submitter ?? form);
		},
		true,
	);
	window.addEventListener(
		'change',
		(event) => {
			if (!enabled || !(event.target instanceof Element)) return;
			const el = event.target;
			if (takePass(el, 'change', event)) {
				// The guarded surface's own fill or select: remember the value so a later blur is not reported.
				if (isTextField(el)) reported.set(el, el.value);
				return;
			}
			if (el instanceof HTMLSelectElement) {
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

/** Sends a `pass` command for this element (`locator.evaluate`). Returns `false` like `commandCaptureScript`. */
export const passCaptureScript = (element: Element, args: CaptureCommandArgs): boolean => {
	const control = (element.ownerDocument.defaultView as unknown as Record<string, unknown> | null)?.[args.stateKey];
	return typeof control === 'function' ? (control as CaptureControl)(args.secret, args.command, element) : false;
};
