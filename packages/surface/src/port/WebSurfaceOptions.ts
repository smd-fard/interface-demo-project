import type { Clock } from '@idp/evidence';
import type { BrowserHandle } from './BrowserHandle.js';
import type { Surface } from './Surface.js';

/** Options for a web surface session. */
export interface WebSurfaceOptions {
	/** The app origin, the base for relative routes, e.g. `http://127.0.0.1:4010`. */
	readonly origin: string;
	/** Origins requests may go to (the network guard aborts the rest). Default: `[origin]`. */
	readonly allowedOrigins?: readonly string[];
	/** Default 1280×800. */
	readonly viewport?: { readonly width: number; readonly height: number };
	/** Upper bound for any single browser operation (default 10 000 ms). */
	readonly defaultTimeoutMs?: number;
	readonly clock?: Clock;
	/**
	 * Row headers whose value cells evidence screenshots mask whole (exact, case-insensitive). Default:
	 * "Share Savings", "Checking", "Member Name", "SSN", "Account".
	 */
	readonly sensitiveRowHeaders?: readonly string[];
}

/** Options for launching a browser-backed web surface. */
export interface LaunchWebSurfaceOptions extends WebSurfaceOptions {
	/** Default true. The attended demo runs headed so an operator can take over the same window. */
	readonly headless?: boolean;
	/** Slows every browser operation by this many ms (demo visibility). */
	readonly slowMo?: number;
}

/** A surface and the opaque handle on its browser session. */
export interface WebSurfaceSession {
	readonly surface: Surface;
	readonly handle: BrowserHandle;
}
