import { systemClock } from '@idp/evidence';
import type { Browser } from 'playwright';
import { DialogMonitor } from '../dialogs/DialogMonitor.js';
import type { WebSurfaceOptions, WebSurfaceSession } from '../port/WebSurfaceOptions.js';
import { createBrowserHandle } from './BrowserHandle.js';
import { installNetworkGuard } from './networkGuard.js';
import { NavigationTracker } from './NavigationTracker.js';
import { WebSurface } from './WebSurface.js';

/**
 * Opens a fresh context and page on a running browser and wires the guards and monitors. Internal: callers
 * outside the package use `launchWebSurface` (or the testing fixture), which own the browser.
 */
export async function openWebSurface(
	browser: Browser,
	options: WebSurfaceOptions,
	ownsBrowser: boolean,
): Promise<WebSurfaceSession> {
	const context = await browser.newContext({ viewport: options.viewport ?? { width: 1280, height: 800 } });
	try {
		const networkGuard = await installNetworkGuard(context, options.allowedOrigins ?? [options.origin]);
		const page = await context.newPage();
		page.setDefaultTimeout(options.defaultTimeoutMs ?? 10_000);
		const clock = options.clock ?? systemClock;
		let closing: Promise<void> | null = null;
		const close = () => {
			closing ??= (async () => {
				await context.close();
				if (ownsBrowser) await browser.close();
			})();
			return closing;
		};
		const surface = new WebSurface({
			page,
			origin: options.origin,
			clock,
			dialogs: new DialogMonitor(page),
			navigation: new NavigationTracker(page, clock),
			...(options.sensitiveRowHeaders === undefined ? {} : { sensitiveRowHeaders: options.sensitiveRowHeaders }),
			close,
		});
		const handle = createBrowserHandle(
			{ browser: ownsBrowser ? browser : null, context, page, networkGuard },
			async () => {
				await surface.close();
			},
		);
		return { surface, handle };
	} catch (error) {
		await context.close();
		throw error;
	}
}
