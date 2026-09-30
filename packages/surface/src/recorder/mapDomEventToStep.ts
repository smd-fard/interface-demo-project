import type { ElementFingerprint } from '../port/ElementFingerprint.js';
import type { DomEventDescriptor } from './DomEventDescriptor.js';

/** A human gesture as a registered action kind, before the policy check. */
export interface RecordedGesture {
	readonly kind: 'click' | 'fill' | 'select' | 'press';
	readonly fingerprint: ElementFingerprint;
	/** `fill`: the typed text; `select`: the option label; `press`: the key. */
	readonly value?: string;
	/** True for every `fill`: the typed text is redacted at every sink. */
	readonly sensitive: boolean;
}

/** Input types whose `change` is covered by the click that caused it, or that carry no typed text. */
const NOT_TYPED = new Set(['checkbox', 'radio', 'file', 'submit', 'button', 'image', 'reset', 'hidden']);

/**
 * Maps a captured DOM event to the action kind a human performed (R6.2): `click` and `submit` (on its
 * submitter) → click; Enter `keydown` → press Enter; `change` on a text field → fill (value sensitive); on a
 * select → select (option label). Anything else (other keys, a checkbox change, a submit with no submitter)
 * is not an action and maps to `null`. Pure.
 */
export function mapDomEventToStep(
	descriptor: DomEventDescriptor,
	fingerprint: ElementFingerprint,
): RecordedGesture | null {
	switch (descriptor.event) {
		case 'click':
			return { kind: 'click', fingerprint, sensitive: false };
		case 'submit':
			return descriptor.tag === 'form' ? null : { kind: 'click', fingerprint, sensitive: false };
		case 'keydown':
			return descriptor.key === 'Enter' ? { kind: 'press', fingerprint, value: 'Enter', sensitive: false } : null;
		case 'change': {
			if (descriptor.tag === 'select') {
				return descriptor.optionLabel === undefined
					? null
					: { kind: 'select', fingerprint, value: descriptor.optionLabel, sensitive: false };
			}
			const typed =
				descriptor.tag === 'textarea' || (descriptor.tag === 'input' && !NOT_TYPED.has(descriptor.inputType ?? 'text'));
			return typed && descriptor.value !== undefined
				? { kind: 'fill', fingerprint, value: descriptor.value, sensitive: true }
				: null;
		}
	}
}
