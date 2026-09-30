/** Headers on every console response: no caching, no sniffing, no framing, no referrer. */
export const BASE_HEADERS: Readonly<Record<string, string>> = {
	'cache-control': 'no-store',
	'x-content-type-options': 'nosniff',
	'x-frame-options': 'DENY',
	'referrer-policy': 'no-referrer',
};

/** The CSP of a console page: nothing but same-origin images/fetches and the nonce'd inline script and style. */
export function pageCsp(nonce: string): string {
	return [
		"default-src 'none'",
		`script-src 'nonce-${nonce}'`,
		`style-src 'nonce-${nonce}'`,
		"img-src 'self'",
		"connect-src 'self'",
		"form-action 'self'",
		"base-uri 'none'",
		"frame-ancestors 'none'",
	].join('; ');
}

/** The CSP of anything that is not a page (JSON, proxied evidence): nothing may run or load. */
export const DATA_CSP = "default-src 'none'; frame-ancestors 'none'; sandbox";
