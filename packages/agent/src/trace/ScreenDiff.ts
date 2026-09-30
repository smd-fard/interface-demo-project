import type { FramePath } from '@idp/surface';

/** A frame whose document title changed. */
export interface TitleChange {
	readonly frame: FramePath;
	/** `null` when the frame did not exist before. */
	readonly before: string | null;
	readonly after: string;
	/**
	 * Parts of the new title (split on ` - `, `|`, `:`) that are visible in the frame's text after the action
	 * and were not before, e.g. `Member Search` for `CoreOne - Member Search`: a text checkpoint candidate.
	 */
	readonly visibleSegments: readonly string[];
}

/** A named element of a checkpoint-worthy role that is on screen after the action and was not before. */
export interface AddedElement {
	readonly frame: FramePath;
	readonly role: string;
	readonly name: string;
}

/** A frame whose document path changed (query strings are not compared). */
export interface RouteChange {
	readonly frame: FramePath;
	readonly before: string | null;
	readonly after: string;
}

/**
 * What an action changed on screen, in the order the compiler prefers for a checkpoint (FR8, invariant 5):
 * titles and headings, then new role+name elements, then routes. Every string is placeholderized and masked
 * by the redactor before it is stored.
 */
export interface ScreenDiff {
	/** The frame of the last document load the action caused, if any: its changes are preferred. */
	readonly loadedFrame: FramePath | null;
	readonly titleChanges: readonly TitleChange[];
	readonly headingsAdded: readonly { readonly frame: FramePath; readonly text: string }[];
	readonly elementsAdded: readonly AddedElement[];
	readonly routeChanges: readonly RouteChange[];
	/** Title parts visible in their frame after the action, changed or not (a presence fallback for select). */
	readonly presentTexts: readonly { readonly frame: FramePath; readonly text: string }[];
	readonly dialogOpened: boolean;
	readonly dialogClosed: boolean;
}
