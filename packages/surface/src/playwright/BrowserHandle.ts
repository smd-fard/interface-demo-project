import type { Browser, BrowserContext, Page } from 'playwright';
import type { BrowserHandle } from '../port/BrowserHandle.js';
import type { NetworkGuard } from './networkGuard.js';

/** The Playwright objects behind a handle. Internal (recorder, testing harness); never exported from the barrel. */
export interface BrowserInternals {
	readonly browser: Browser | null;
	readonly context: BrowserContext;
	readonly page: Page;
	/** The context's network guard (its navigation hook is set by the human-action recorder). */
	readonly networkGuard: NetworkGuard;
}

const internals = new WeakMap<BrowserHandle, BrowserInternals>();

/** Wraps the Playwright objects in an opaque `BrowserHandle`; the internals stay reachable only inside this package. */
export function createBrowserHandle(parts: BrowserInternals, close: () => Promise<void>): BrowserHandle {
	let closed = false;
	parts.page.on('close', () => {
		closed = true;
	});
	const handle: BrowserHandle = {
		bringToFront: () => parts.page.bringToFront(),
		close: async () => {
			if (closed) return;
			closed = true;
			await close();
		},
		get closed() {
			return closed || parts.page.isClosed();
		},
	};
	internals.set(handle, parts);
	return handle;
}

/** The Playwright objects of a handle created by this package. */
export function browserInternals(handle: BrowserHandle): BrowserInternals {
	const parts = internals.get(handle);
	if (parts === undefined) throw new TypeError('not a BrowserHandle created by @idp/surface');
	return parts;
}
