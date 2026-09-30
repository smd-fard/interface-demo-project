import { chromium, type Browser } from 'playwright';
import { openWebSurface } from '../playwright/openWebSurface.js';
import type { WebSurfaceOptions, WebSurfaceSession } from '../port/WebSurfaceOptions.js';

/** One browser for a test file; each `newSession` is a fresh context and page (no shared cookies). */
export interface BrowserFixture {
	/** A web surface in a fresh context. Closed by `closeSessions` / `close`, or by the caller. */
	newSession(options: WebSurfaceOptions): Promise<WebSurfaceSession>;
	/** Closes every session opened so far (call it in `afterEach`). */
	closeSessions(): Promise<void>;
	/** Closes the sessions and the browser (call it in `afterAll`). */
	close(): Promise<void>;
}

/** Launches one headless Chromium (already installed; never downloaded) for a functional test file. */
export async function launchBrowserFixture(options: { readonly headless?: boolean } = {}): Promise<BrowserFixture> {
	const browser: Browser = await chromium.launch({ headless: options.headless ?? true });
	const sessions: WebSurfaceSession[] = [];
	const closeSessions = async () => {
		const open = sessions.splice(0);
		await Promise.all(open.map((session) => session.handle.close()));
	};
	return {
		newSession: async (surfaceOptions) => {
			const session = await openWebSurface(browser, surfaceOptions, false);
			sessions.push(session);
			return session;
		},
		closeSessions,
		close: async () => {
			await closeSessions();
			await browser.close();
		},
	};
}
