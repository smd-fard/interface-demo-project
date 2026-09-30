/** The origin and path of a URL, used for allowlist checks. The query and hash are ignored. */
export interface UrlParts {
	readonly origin: string;
	readonly path: string;
}

/**
 * Parses `url` (optionally relative to `base`) into origin and path. Returns undefined for anything that is
 * not an http(s) URL, so callers deny it. Never throws.
 */
export function urlParts(url: string, base?: string): UrlParts | undefined {
	if (typeof url !== 'string' || !URL.canParse(url, base)) return undefined;
	const parsed = new URL(url, base);
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
	return { origin: parsed.origin, path: parsed.pathname };
}
