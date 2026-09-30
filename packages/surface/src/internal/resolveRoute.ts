import { NavigationBlockedError } from '../errors/NavigationBlockedError.js';
import { blockedOriginOf } from '../playwright/networkGuard.js';

/**
 * Resolves a `navigate` route against the surface origin. A route is relative to the app: anything that
 * resolves to another origin or scheme (`//host/…`, `https://…`, `javascript:…`) throws `NavigationBlockedError`.
 */
export function resolveRoute(origin: string, route: string): string {
	const base = new URL(origin);
	let url: URL;
	try {
		url = new URL(route, base);
	} catch {
		throw new NavigationBlockedError('(invalid url)');
	}
	if (url.origin !== base.origin) throw new NavigationBlockedError(blockedOriginOf(url.href));
	return url.href;
}
