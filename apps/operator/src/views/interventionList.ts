import type { InterventionRequest } from '@idp/artifact-schema';
import type { LeaseView } from '@idp/session';
import { actionForm, type FormAction } from './actionForm.js';
import { escapeHtml } from './escapeHtml.js';
import { subjectText } from './subjectText.js';

/** What the list page renders: the open requests, the lease, and the form token for Resume / Abort. */
export interface InterventionListInput {
	readonly requests: readonly InterventionRequest[];
	readonly lease: Pick<LeaseView, 'state' | 'holder'>;
	readonly formToken: string;
	readonly operator?: string;
}

function leaseActions(lease: Pick<LeaseView, 'state'>): FormAction[] {
	const actions: FormAction[] = [];
	if (lease.state === 'HUMAN') actions.push({ label: 'Resume', route: '/resume' });
	if (lease.state !== 'CLOSED') actions.push({ label: 'Abort', route: '/abort' });
	return actions;
}

function row(request: InterventionRequest): string {
	const id = escapeHtml(request.id);
	return (
		`<tr data-status="${escapeHtml(request.status)}">` +
		`<td><a href="/interventions/${id}">${id}</a></td>` +
		`<td>${escapeHtml(request.kind)}</td>` +
		`<td>${escapeHtml(request.status)}</td>` +
		`<td><code>${escapeHtml(request.reason.code)}</code> ${escapeHtml(request.reason.text)}</td>` +
		`<td>${escapeHtml(subjectText(request))}</td>` +
		`<td>${escapeHtml(request.createdAt)}</td>` +
		'</tr>'
	);
}

/** The list page body: every intervention request of the session, and the lease-level controls. */
export function interventionList(input: InterventionListInput): string {
	const table =
		input.requests.length === 0
			? '<p class="empty">No intervention requests. The run has not asked for a human.</p>'
			: [
					'<table id="interventions">',
					'<thead><tr><th>Request</th><th>Kind</th><th>Status</th><th>Reason</th><th>Subject</th><th>Raised</th></tr></thead>',
					`<tbody>${input.requests.map(row).join('')}</tbody>`,
					'</table>',
				].join('\n');
	return [
		'<h1>Intervention requests</h1>',
		table,
		'<h2>Session</h2>',
		actionForm({
			actions: leaseActions(input.lease),
			formToken: input.formToken,
			returnTo: '/',
			...(input.operator === undefined ? {} : { operator: input.operator }),
		}),
	].join('\n');
}
