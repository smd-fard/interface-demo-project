import type { PendingDialog } from './PendingDialog.js';

/**
 * A frame's position in the frame tree, from the top document down: each hop is the frame's `name`, or
 * `#<i>` (its index among its parent's child frames) when it has none. `[]` is the top document.
 */
export type FramePath = readonly string[];

/** One node of the frame-aware accessibility tree. Plain data: no browser types. */
export interface A11yNode {
	/**
	 * `e<N>`: stable within one observation, used by the agent to name a target. Absent on pseudo-nodes that
	 * cannot be acted on (`document`, `iframe`, `text`).
	 */
	readonly ref?: string;
	/** ARIA role (`button`, `textbox`, `cell`, …), or `document` / `iframe` / `text` for structure. */
	readonly role: string;
	/** The accessible name ("" when there is none; the text itself for a `text` node). */
	readonly name: string;
	/** The current value of a text input, when shown. May be sensitive: redact before any sink. */
	readonly value?: string;
	/** ARIA states and properties shown in the snapshot, e.g. `{ checked: true, level: '2' }`. */
	readonly states?: Readonly<Record<string, string | true>>;
	/** Snapshot properties, e.g. `{ url: '/member/search' }` for a link. */
	readonly props?: Readonly<Record<string, string>>;
	/** The frame whose document holds the node. */
	readonly framePath: FramePath;
	readonly children: readonly A11yNode[];
}

/** One document load of the top document or a frame. */
export interface NavigationInfo {
	/** The frame the document loaded in. */
	readonly framePath: FramePath;
	readonly url: string;
	/** The HTTP status, or `null` when the load failed without a response (aborted, network error). */
	readonly status: number | null;
	readonly durationMs: number;
}

/** A frame (or the top document, path `[]`) at observation time. */
export interface FrameInfo {
	readonly path: FramePath;
	/** The frame `name` attribute ("" for the top document or an unnamed frame). */
	readonly name: string;
	readonly url: string;
	readonly title: string;
	/** The HTTP status of the frame's current document, when known. */
	readonly status: number | null;
	/** Visible text (`innerText`), whitespace-normalized and bounded. May be sensitive: redact before any sink. */
	readonly text: string;
	/** True when `text` was cut at the bound. */
	readonly textTruncated: boolean;
}

/**
 * What the surface sees: the frame-aware accessibility tree (the primary perception), per-frame text and
 * titles for condition detection, the pending native dialog, and the last document load. Not redacted: every
 * consumer redacts before a sink (invariant 3).
 */
export interface Observation {
	/** URL of the top document. */
	readonly url: string;
	/** Title of the top document. */
	readonly title: string;
	/** Every frame, top document first, in tree (pre-)order. */
	readonly frames: readonly FrameInfo[];
	/** The merged tree: the top `document`, with each frame's document grafted under its `iframe` node. */
	readonly tree: A11yNode;
	readonly pendingDialog: PendingDialog | null;
	/** The most recent document load in any frame, or `null` before the first navigation. */
	readonly lastNavigation: NavigationInfo | null;
	/** A hash of what is on screen (tree, values, urls, titles, dialog), for no-progress detection. */
	readonly digest: string;
}

/** Options for `Surface.observe`. */
export interface ObserveOptions {
	/** Upper bound on each frame's `text` (default 20 000 characters). */
	readonly maxTextChars?: number;
}
