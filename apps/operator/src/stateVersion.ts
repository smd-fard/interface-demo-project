import { createHash } from 'node:crypto';
import type { InterventionRequest } from '@idp/artifact-schema';
import type { LeaseView } from '@idp/session';

/**
 * A short fingerprint of what the console shows: the lease state and holder, and each request's id and
 * status. The page carries it; the polling script reloads when `/api/state` reports a different one.
 */
export function stateVersion(
	lease: Pick<LeaseView, 'state' | 'holder'>,
	requests: readonly Pick<InterventionRequest, 'id' | 'status'>[],
): string {
	const text = [lease.state, lease.holder, ...requests.map((request) => `${request.id}:${request.status}`)].join('|');
	return createHash('sha256').update(text).digest('hex').slice(0, 16);
}
