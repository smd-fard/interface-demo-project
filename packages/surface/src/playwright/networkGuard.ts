import type { BrowserContext, Request } from 'playwright';

const ALWAYS_ALLOWED = new Set(['about:', 'data:']);

/** The origin of an allowlist entry, or `null` for an entry that is not a URL (it then matches nothing). */
function normalizeOrigin(origin: string): string | null {
	return URL.canParse(origin) ? new URL(origin).origin : null;
}

/**
 * Whether a request may leave the browser: http(s) to an allowlisted origin, or `about:` / `data:`. Every
 * other scheme (file:, javascript:, ws:, …) and origin is refused.
 */
export function isRequestAllowed(url: string, allowedOrigins: readonly string[]): boolean {
	// A request URL that does not parse is refused.
	if (!URL.canParse(url)) return false;
	const parsed = new URL(url);
	if (ALWAYS_ALLOWED.has(parsed.protocol)) return true;
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
	return allowedOrigins.some((origin) => normalizeOrigin(origin) === parsed.origin);
}

/** The part of a refused URL that is safe to log: its origin (http/https) or its scheme. */
export function blockedOriginOf(url: string): string {
	if (!URL.canParse(url)) return '(invalid url)';
	const parsed = new URL(url);
	return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : parsed.protocol;
}

/** A request the guard aborted: its origin only, and whether it was a document navigation. */
export interface BlockedRequest {
	readonly origin: string;
	readonly navigation: boolean;
}

/** What a navigation hook decides for a document request to an allowlisted origin. */
export type NavigationDecision = 'continue' | 'abort';

/**
 * Consulted (synchronously) for every document (navigation) request to an allowlisted origin while set — the
 * human-action recorder uses it to policy-check navigations nobody mediated (e.g. typed in the address bar).
 */
export type NavigationHook = (request: Request) => NavigationDecision;

/** The error a navigation refused by the hook fails with (`net::ERR_ACCESS_DENIED`), distinct from an origin block. */
export const HOOK_ABORT_ERROR = 'accessdenied';

/** The installed guard: the live list of blocked requests and the navigation hook slot. */
export interface NetworkGuard {
	readonly blocked: BlockedRequest[];
	/** Sets (or, with `null`, clears) the navigation hook. At most one is set. */
	setNavigationHook(hook: NavigationHook | null): void;
}

/**
 * Defence in depth behind the policy check: aborts every request of the context to an origin outside the
 * allowlist (and every non-http(s) scheme except about:/data:) with `blockedbyclient`. A navigation request to
 * an allowed origin is then passed to the navigation hook, when one is set; `abort` fails it with
 * `accessdenied`.
 */
export async function installNetworkGuard(
	context: BrowserContext,
	allowedOrigins: readonly string[],
): Promise<NetworkGuard> {
	const blocked: BlockedRequest[] = [];
	let hook: NavigationHook | null = null;
	await context.route('**', async (route) => {
		const request = route.request();
		if (!isRequestAllowed(request.url(), allowedOrigins)) {
			blocked.push({ origin: blockedOriginOf(request.url()), navigation: request.isNavigationRequest() });
			await route.abort('blockedbyclient');
			return;
		}
		if (hook !== null && request.isNavigationRequest() && hook(request) === 'abort') {
			await route.abort(HOOK_ABORT_ERROR);
			return;
		}
		await route.fallback();
	});
	return {
		blocked,
		setNavigationHook: (next) => {
			hook = next;
		},
	};
}
