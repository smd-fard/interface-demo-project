/**
 * What the capture script reports for one human gesture in a frame. The element itself stays in the page,
 * tagged with `token`; the recorder finds it in the reporting frame and fingerprints it.
 */
export interface DomEventDescriptor {
	/** `click`, `submit` and Enter `keydown` were blocked (not performed); `change` was not. */
	readonly event: 'click' | 'submit' | 'keydown' | 'change';
	/** The element's `data-idp-rec` token in its frame. */
	readonly token: string;
	/** Lowercase tag name (`form` for a submit without a submitter). */
	readonly tag: string;
	/** For `<input>`: its type, lowercased (`text` when absent). */
	readonly inputType: string | null;
	/** For `keydown`: the key. */
	readonly key?: string;
	/** For `change` on a text field: the typed value. Sensitive: never log it. */
	readonly value?: string;
	/** For `change` on a `<select>`: the selected option's label. */
	readonly optionLabel?: string;
}
