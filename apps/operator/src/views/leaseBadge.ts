import type { LeaseView } from '@idp/session';
import { escapeHtml } from './escapeHtml.js';

/** The lease badge: who controls the live session right now. The polling script refreshes it. */
export function leaseBadge(lease: Pick<LeaseView, 'state' | 'holder'>): string {
	const state = escapeHtml(lease.state);
	return (
		`<span id="lease-badge" class="lease lease-${state.toLowerCase()}" data-state="${state}">` +
		`Lease: <strong>${state}</strong> · holder <span class="holder">${escapeHtml(lease.holder)}</span></span>`
	);
}
