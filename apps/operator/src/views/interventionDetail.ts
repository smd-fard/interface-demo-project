import type { InterventionRequest } from '@idp/artifact-schema';
import type { LeaseView } from '@idp/session';
import { actionForm, type FormAction } from './actionForm.js';
import { escapeHtml } from './escapeHtml.js';
import { subjectText } from './subjectText.js';

/** What the intervention detail page renders: the request, the lease, and the form token for its actions. */
export interface InterventionDetailInput {
	readonly request: InterventionRequest;
	readonly lease: Pick<LeaseView, 'state' | 'holder'>;
	readonly formToken: string;
	readonly operator?: string;
}

/** The actions the request offers and the lease allows right now, in display order. */
function allowedActions(request: InterventionRequest, lease: Pick<LeaseView, 'state'>): FormAction[] {
	const base = `/interventions/${encodeURIComponent(request.id)}`;
	const offers = (option: InterventionRequest['options'][number]) => request.options.includes(option);
	const actions: FormAction[] = [];
	if (request.status === 'resolved' || lease.state === 'CLOSED') return actions;
	const open = request.status === 'open' && lease.state === 'PAUSED';
	if (request.kind === 'takeover' && open) actions.push({ label: 'Take control', route: `${base}/claim` });
	if (request.kind === 'approval' && open && offers('approve'))
		actions.push({ label: 'Approve', route: `${base}/approve` });
	if (request.kind === 'approval' && open && offers('reject'))
		actions.push({ label: 'Reject', route: `${base}/reject` });
	if (request.status === 'claimed' && lease.state === 'HUMAN' && offers('resumed'))
		actions.push({ label: 'Resume', route: '/resume' });
	if (offers('aborted')) actions.push({ label: 'Abort', route: '/abort' });
	return actions;
}

function field(label: string, value: string): string {
	return `<dt>${escapeHtml(label)}</dt><dd>${value}</dd>`;
}

function screenshot(request: InterventionRequest): string {
	const { screenshotRef, a11ySnapshotRef } = request.state;
	const image =
		screenshotRef === null
			? '<p class="empty">No screenshot was captured at pause time.</p>'
			: `<img src="/evidence/${escapeHtml(screenshotRef.id)}" alt="Masked screenshot at pause time" class="screenshot">`;
	const snapshot =
		a11ySnapshotRef === null
			? ''
			: `<p><a href="/evidence/${escapeHtml(a11ySnapshotRef.id)}">Redacted accessibility snapshot</a></p>`;
	return `${image}\n${snapshot}`;
}

/**
 * The detail page body of one intervention request: the masked screenshot, why the run paused, the step and
 * its risk, the subject, the redacted page url/title, and the actions allowed now. Every value is already
 * redacted by the session; every value is HTML-escaped here.
 */
export function interventionDetail(input: InterventionDetailInput): string {
	const { request } = input;
	const step = request.currentStep;
	const resolution =
		request.resolution === undefined
			? ''
			: field(
					'Resolution',
					`${escapeHtml(request.resolution.decision)} by ${escapeHtml(request.resolution.by)} at ${escapeHtml(
						request.resolution.at,
					)}`,
				);
	return [
		`<h1>Intervention <code>${escapeHtml(request.id)}</code></h1>`,
		`<p><a href="/">&larr; All requests</a></p>`,
		`<dl id="request" data-status="${escapeHtml(request.status)}">`,
		field('Kind', escapeHtml(request.kind)),
		field('Status', escapeHtml(request.status)),
		field('Reason', `<code>${escapeHtml(request.reason.code)}</code> ${escapeHtml(request.reason.text)}`),
		field(
			'Step',
			`#${escapeHtml(step.index)}${step.id === undefined ? '' : ` <code>${escapeHtml(step.id)}</code>`} ${escapeHtml(
				step.description,
			)}`,
		),
		field('Risk', `<span class="risk risk-${escapeHtml(step.risk)}">${escapeHtml(step.risk)}</span>`),
		field('Subject', escapeHtml(subjectText(request))),
		field('Run', `${escapeHtml(request.runKind)} <code>${escapeHtml(request.runId)}</code>`),
		field('Page', `${escapeHtml(request.state.title)}<br><code>${escapeHtml(request.state.url)}</code>`),
		field('Raised', escapeHtml(request.createdAt)),
		resolution,
		'</dl>',
		actionForm({
			actions: allowedActions(request, input.lease),
			formToken: input.formToken,
			returnTo: `/interventions/${request.id}`,
			...(input.operator === undefined ? {} : { operator: input.operator }),
		}),
		screenshot(request),
	].join('\n');
}
