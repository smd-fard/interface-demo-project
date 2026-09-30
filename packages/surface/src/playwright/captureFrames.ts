import type { Frame, Page } from 'playwright';
import { normalizeText } from '../internal/normalizeText.js';
import { framePathOf } from '../locators/FrameResolver.js';
import type { FrameInfo } from '../port/Observation.js';
import type { FrameSnapshot } from '../snapshot/a11ySnapshot.js';
import type { NavigationTracker } from './NavigationTracker.js';

/** Bounds for one frame capture: text budget, per-frame snapshot timeout and whether in-page evaluation is allowed. */
export interface CaptureFramesOptions {
	readonly maxTextChars: number;
	/** Per-frame bound for the aria snapshot (a frame that times out is reported unavailable). */
	readonly snapshotTimeoutMs: number;
	/** Skip every in-page evaluation (a native dialog blocks the page's script). */
	readonly domAccess: boolean;
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
		} catch {
			// detached while we looked: it is simply not part of this observation
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
			yaml = await frame
				.locator(':root')
				.ariaSnapshot({ timeout: options.snapshotTimeoutMs })
				.catch(() => null);
			title = await frame.title().catch(() => '');
			text = normalizeText(await frame.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => ''));
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
