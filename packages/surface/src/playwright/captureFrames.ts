import { errors, type Frame, type Page } from 'playwright';
import { isGoneFrameError } from '../internal/isGoneFrameError.js';
import { framePathOf } from '../locators/FrameResolver.js';
import type { FrameInfo } from '../port/Observation.js';
import type { FrameSnapshot } from '../snapshot/a11ySnapshot.js';
import { readFrameText, titleOrEmpty } from './frameReads.js';
import type { NavigationTracker } from './NavigationTracker.js';

/** Bounds for one frame capture: text budget, per-frame snapshot timeout and whether in-page evaluation is allowed. */
export interface CaptureFramesOptions {
	readonly maxTextChars: number;
	/** Per-frame bound for the aria snapshot (a frame that times out is reported unavailable). */
	readonly snapshotTimeoutMs: number;
	/** Skip every in-page evaluation (a native dialog blocks the page's script). */
	readonly domAccess: boolean;
}

/**
 * A frame's aria snapshot, or `null` ("unavailable" in the observation) when it timed out or the frame went away
 * while it was taken. Any other error is thrown.
 */
async function ariaSnapshotOrNull(frame: Frame, timeoutMs: number): Promise<string | null> {
	try {
		return await frame.locator(':root').ariaSnapshot({ timeout: timeoutMs });
	} catch (error) {
		if (error instanceof errors.TimeoutError || isGoneFrameError(error)) return null;
		throw error;
	}
}

/** Frames in tree pre-order: top document first, each frame followed by its descendants. */
function framesInTreeOrder(page: Page): Frame[] {
	const ordered: Frame[] = [];
	const visit = (frame: Frame) => {
		if (frame.isDetached()) return;
		ordered.push(frame);
		for (const child of frame.childFrames()) visit(child);
	};
	visit(page.mainFrame());
	return ordered;
}

/** Child frames whose element is rendered, in document order — they fill the parent's `iframe` nodes. */
async function renderedChildPaths(frame: Frame): Promise<string[][]> {
	const placed: { path: string[]; index: number }[] = [];
	for (const child of frame.childFrames()) {
		try {
			const element = await child.frameElement();
			const { index, rendered } = await element.evaluate((node) => {
				const el = node as Element;
				return {
					index: [...document.querySelectorAll('frame, iframe')].indexOf(el),
					rendered: el.getClientRects().length > 0,
				};
			});
			placed.push({ path: [...framePathOf(child)], index: rendered ? index : Number.MAX_SAFE_INTEGER });
		} catch (error) {
			// Detached (or navigated) while we looked: it is simply not part of this observation.
			if (!isGoneFrameError(error)) throw error;
		}
	}
	return placed.sort((a, b) => a.index - b.index).map((entry) => entry.path);
}

/**
 * Takes each frame's own aria snapshot (Playwright snapshots one document at a time; the merge into one
 * tree is the pure `buildA11yTree`) and its url, title, status and bounded visible text.
 */
export async function captureFrames(
	page: Page,
	tracker: NavigationTracker,
	options: CaptureFramesOptions,
): Promise<{ snapshots: FrameSnapshot[]; infos: FrameInfo[] }> {
	const snapshots: FrameSnapshot[] = [];
	const infos: FrameInfo[] = [];
	for (const frame of framesInTreeOrder(page)) {
		const path = framePathOf(frame);
		let yaml: string | null = null;
		let title = '';
		let text = '';
		let childPaths: string[][] = [];
		if (options.domAccess) {
			yaml = await ariaSnapshotOrNull(frame, options.snapshotTimeoutMs);
			title = await titleOrEmpty(frame);
			const read = await readFrameText(frame);
			// A frame that went away mid-read contributes no text to this observation (it is reported loading).
			text = read.kind === 'text' ? read.text : '';
			childPaths = await renderedChildPaths(frame);
		}
		snapshots.push({ path, yaml, childPaths });
		infos.push({
			path,
			name: frame.name(),
			url: frame.url(),
			title,
			status: tracker.statusOf(frame),
			text: text.slice(0, options.maxTextChars),
			textTruncated: text.length > options.maxTextChars,
		});
	}
	return { snapshots, infos };
}
