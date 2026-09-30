import type { Page } from 'playwright';
import type { NavigationTracker } from './NavigationTracker.js';

/** How long no navigation may start after a gesture before the gesture counts as not navigating. */
export const NAVIGATION_QUIET_MS = 150;
const POLL_MS = 25;
const DEFAULT_SETTLE_MS = 10_000;

/**
 * Waits for the loads a gesture started: first until no navigation is in flight and none began for
 * `NAVIGATION_QUIET_MS` (Playwright does not wait for a frame navigation a click or key press starts), then
 * until the top document and every attached frame have fired `load`. Legacy form submits navigate a frame
 * (the frameset's content frame), not the page. A frame detached meanwhile (a reloaded frameset) is skipped.
 */
export async function waitForFramesLoaded(
	page: Page,
	tracker: Pick<NavigationTracker, 'isQuiet' | 'now'>,
	timeoutMs?: number,
): Promise<void> {
	const since = tracker.now();
	const deadline = since + (timeoutMs ?? DEFAULT_SETTLE_MS);
	while (!tracker.isQuiet(NAVIGATION_QUIET_MS, since) && tracker.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, POLL_MS));
	}
	const options = timeoutMs === undefined ? {} : { timeout: Math.max(1, deadline - tracker.now()) };
	await page.waitForLoadState('load', options);
	for (const frame of page.frames()) {
		if (frame.isDetached()) continue;
		try {
			await frame.waitForLoadState('load', options);
		} catch (error) {
			if (!frame.isDetached()) throw error;
		}
	}
}
