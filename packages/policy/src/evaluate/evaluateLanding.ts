import type { ResolvedPolicy } from '../config/ResolvedPolicy.js';
import type { LandingVerdict } from '../verdict/PolicyVerdict.js';
import { checkUrl } from './checkUrl.js';

/**
 * The post-action check: the URL the top document landed on after acting (e.g. a click that followed a link)
 * must still be on an allowed origin and route. Pure; never throws.
 */
export function evaluateLanding(landingUrl: string, policy: ResolvedPolicy): LandingVerdict {
	return checkUrl(policy, landingUrl) ?? { kind: 'allow' };
}
