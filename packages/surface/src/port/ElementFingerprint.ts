import type { FrameScope } from '@idp/artifact-schema';
import type { FramePath } from './Observation.js';

/** The element kinds a `nth_in_container` rung counts. */
export type ContainerElementKind = 'input' | 'select' | 'button' | 'link' | 'cell' | 'row';

/**
 * What the compiler needs to build a locator ladder for an element: its semantic identity (role, name),
 * its layout neighbours (label cell, row and column headers) and its position. Plain data.
 */
export interface ElementFingerprint {
	/** ARIA role, or `null` when the element has none (generic). */
	readonly role: string | null;
	/** Accessible name ("" when there is none, e.g. an input labelled only by an adjacent cell). */
	readonly name: string;
	/** Lowercase tag name, e.g. `input`. */
	readonly tag: string;
	/** The `name` attribute (legacy forms: `txt1`, `btnGo`). */
	readonly nameAttribute: string | null;
	/** For `<input>`: its type, lowercased (`text` when absent). */
	readonly inputType: string | null;
	/** Text of the nearest non-empty cell before the element's cell in the same row (the form_row label). */
	readonly labelCellText: string | null;
	/** Text of the first non-empty cell of the element's row, when it is not the element's own cell. */
	readonly rowHeaderText: string | null;
	/** Text of the cell in the same column in the table's first row, when the element is not in that row. */
	readonly columnHeaderText: string | null;
	/** Where the frame sits in the observation's frame tree. */
	readonly framePath: FramePath;
	/** The same path as a FrameScope (by_name hops; by_url_path for unnamed frames), ready for a TargetRef. */
	readonly frameScope: FrameScope;
	/** Position among elements of its kind in its nearest container (row for cells, else form, else table). */
	readonly container: {
		readonly element: ContainerElementKind;
		readonly index: number;
		/** The first line of the container's visible text, a candidate `containerText`. */
		readonly containerText: string | null;
	} | null;
	/**
	 * Where activating the element would navigate: a link's absolute `href`, or the absolute form action of a
	 * control inside a form (a submit button's `formaction` first); `null` otherwise. The guard checks an
	 * http(s) value against the allowlist before a click or press. May carry a query: redact before any sink.
	 */
	readonly navigatesTo: string | null;
	/** The visible caption: text content, or the `value` of a submit/button input. Never an input's typed value. */
	readonly visibleText: string;
}
