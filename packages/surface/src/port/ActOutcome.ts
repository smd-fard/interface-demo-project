import type { NavigationInfo } from './Observation.js';
import type { PendingDialog } from './PendingDialog.js';
import type { Resolution } from './Resolution.js';

/** What an action did: where it landed, how the last load went, and (for `extract`) the raw text read. */
export interface ActOutcome {
	readonly kind: string;
	/** The top-document URL after the action. */
	readonly url: string;
	/** The latest document load the action caused (any frame), or `null` when it caused none. */
	readonly navigation: NavigationInfo | null;
	/** How the target was resolved, for actions with a ladder target (absent for an observation ref). */
	readonly resolution?: Resolution;
	/** For `extract`: the element's text (an input's value), whitespace-normalized. Sensitive: redact before any sink. */
	readonly extracted?: string;
	/**
	 * A native dialog the action left open (it opened during the action or the load that followed). The page
	 * is blocked until it is settled with `dismiss_dialog`; every other action fails with `DialogPendingError`.
	 * The message may carry app data: redact before any sink.
	 */
	readonly dialog?: PendingDialog;
	/**
	 * For a `click` carrying an approval grant: the `confirm` dialog raised by that click, which the surface
	 * accepted as part of the approved action. Never set without a grant.
	 */
	readonly acceptedDialog?: PendingDialog;
}
