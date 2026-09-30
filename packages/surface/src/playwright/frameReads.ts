import type { Frame } from 'playwright';
import { isGoneFrameError } from '../internal/isGoneFrameError.js';
import { normalizeText } from '../internal/normalizeText.js';

/** A frame's text, or why it could not be read because the frame went away (navigating, detached, closed). */
export type FrameTextRead =
	{ readonly kind: 'text'; readonly text: string } | { readonly kind: 'gone'; readonly reason: string };

/** The first line of an error message (Playwright appends call logs below it). */
export function firstLine(error: unknown): string {
	return error instanceof Error ? (error.message.split('\n')[0] ?? error.name) : String(error);
}

/**
 * Reads a frame's visible text (`body.innerText`, whitespace-normalized). A frame that went away while it was
 * read (`isGoneFrameError`: a navigation replaced its document, or it detached) is reported as `gone` — the
 * caller decides what an unreadable frame means; any other error is real and is thrown.
 */
export async function readFrameText(frame: Frame): Promise<FrameTextRead> {
	try {
		const text = await frame.evaluate(() => (document.body ? document.body.innerText : ''));
		return { kind: 'text', text: normalizeText(text) };
	} catch (error) {
		if (isGoneFrameError(error)) return { kind: 'gone', reason: firstLine(error) };
		throw error;
	}
}

/**
 * A frame's document title, or `''` when the frame went away while it was read (the fallback is deliberate:
 * a navigating frame has no settled title yet, and observers report that frame with an empty title). Any
 * other error is thrown.
 */
export async function titleOrEmpty(frame: Frame): Promise<string> {
	try {
		return await frame.title();
	} catch (error) {
		if (isGoneFrameError(error)) return '';
		throw error;
	}
}
