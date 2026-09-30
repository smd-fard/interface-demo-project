import type { ElementFingerprint } from '../port/ElementFingerprint.js';

/** The action kinds a human gesture maps to. */
export type HumanActionKind = 'click' | 'fill' | 'select' | 'press' | 'dismiss_dialog' | 'navigate';

/**
 * One human action on the live session, as the recorder saw it (R6.2): the registered action kind, the
 * element's fingerprint (the compiler builds a locator ladder from it), the policy verdict, and whether it
 * was refused. Every gesture is blocked in the page and re-executed through the policy-guarded surface, so
 * `refused: false` means the surface performed it.
 */
export interface RecordedHumanAction {
	/** 1-based, in the order the gestures happened. */
	readonly seq: number;
	readonly kind: HumanActionKind;
	/** `null` for `dismiss_dialog` and `navigate` (no element). */
	readonly fingerprint: ElementFingerprint | null;
	/**
	 * `fill`: the typed text (sensitive raw value — consumers must redact before any sink). `select`: the
	 * option label. `press`: the key. `dismiss_dialog`: `accept` | `dismiss`. `navigate`: the origin when an
	 * off-allowlist origin was blocked; otherwise the full URL the navigation requested (sensitive: it may carry
	 * values in its query — consumers must redact before any sink).
	 */
	readonly value?: string;
	/** True when `value` is sensitive (every `fill`, and a `navigate` carrying a URL). */
	readonly sensitive: boolean;
	/** The policy verdict; `null` when the gesture could not be evaluated (see `errorCode`). */
	readonly verdict: 'allow' | 'deny' | 'require_approval' | null;
	/** True when the surface did not perform the action. */
	readonly refused: boolean;
	/** ISO-8601, from the injected clock. */
	readonly at: string;
	/** For a denial: the policy deny code. */
	readonly denyCode?: string;
	/** Set when the action failed or could not be replayed (a typed error code, or `TARGET_NOT_REPLAYABLE`). */
	readonly errorCode?: string;
}
