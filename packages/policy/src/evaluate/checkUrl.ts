import type { ResolvedPolicy } from '../config/ResolvedPolicy.js';
import { urlParts } from '../config/urlParts.js';
import type { DenyVerdict } from '../verdict/PolicyVerdict.js';

/**
 * The origin and route allowlist check shared by `evaluateAction` and `evaluateLanding`. Returns a deny verdict,
 * or undefined when the URL is allowed. The reason names origin and path only (no query, no hash).
 */
export function checkUrl(
	policy: ResolvedPolicy,
	url: string,
	base?: string,
): DenyVerdict<'origin_not_allowed' | 'route_not_allowed'> | undefined {
	const parts = typeof url === 'string' ? urlParts(url, base) : undefined;
	if (parts === undefined) {
		return { kind: 'deny', code: 'origin_not_allowed', reason: 'URL is not an http(s) URL on an allowed origin' };
	}
	if (!policy.origins.has(parts.origin)) {
		return { kind: 'deny', code: 'origin_not_allowed', reason: `origin ${parts.origin} is not allowlisted` };
	}
	if (!policy.isRouteAllowed(parts.origin, parts.path)) {
		return {
			kind: 'deny',
			code: 'route_not_allowed',
			reason: `route ${parts.path} is not allowlisted on ${parts.origin}`,
		};
	}
	return undefined;
}
