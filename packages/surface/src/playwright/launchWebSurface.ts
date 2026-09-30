import { chromium } from 'playwright';
import type { LaunchWebSurfaceOptions, WebSurfaceSession } from '../port/WebSurfaceOptions.js';
import { openWebSurface } from './openWebSurface.js';

/**
 * Launches Chromium (already installed via `pnpm setup:browsers`; never downloaded here) and returns the
 * `Surface` plus the `BrowserHandle` the session keeps for the handoff. Closing either closes the browser.
 */
export async function launchWebSurface(options: LaunchWebSurfaceOptions): Promise<WebSurfaceSession> {
	const browser = await chromium.launch({
		headless: options.headless ?? true,
		...(options.slowMo === undefined ? {} : { slowMo: options.slowMo }),
	});
	try {
		return await openWebSurface(browser, options, true);
	} catch (error) {
		await browser.close();
		throw error;
	}
}
