import type { InterventionRequest } from '@idp/artifact-schema';
import { describe, expect, it } from 'vitest';
import {
	APPROVAL_ID,
	approvalRequest,
	humanLease,
	pausedLease,
	TAKEOVER_ID,
	takeoverRequest,
	TOKEN,
} from '../fixtures.test-helper.js';
import { escapeHtml } from './escapeHtml.js';
import { interventionDetail } from './interventionDetail.js';
import { interventionList } from './interventionList.js';
import { layout } from './layout.js';
import { leaseBadge } from './leaseBadge.js';

const FORM_TOKEN = 'f'.repeat(64);
const NONCE = 'bm9uY2Utbm9uY2U';

const buttons = (html: string) => [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((match) => match[1]);

describe('escapeHtml', () => {
	it('escapes the five HTML metacharacters', () => {
		expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
			'&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
		);
	});
});

describe('leaseBadge', () => {
	it('shows the state and the holder', () => {
		const html = leaseBadge(pausedLease);
		expect(html).toContain('id="lease-badge"');
		expect(html).toContain('data-state="PAUSED"');
		expect(html).toContain('PAUSED');
		expect(html).toContain('none');
	});
});

describe('layout', () => {
	const page = layout({
		title: 'Interventions',
		nonce: NONCE,
		lease: pausedLease,
		stateVersion: 'PAUSED|none|x',
		body: '<p>body</p>',
	});

	it('states that it is a deliberately mocked console and links to REPORT §5', () => {
		expect(page).toMatch(/deliberately mocked/i);
		expect(page).toContain('<a href="REPORT.md#5">REPORT §5</a>');
	});

	it('carries the nonce on its inline script and style only', () => {
		expect(page).toContain(`<script nonce="${NONCE}">`);
		expect(page).toContain(`<style nonce="${NONCE}">`);
		expect(page.match(/<script/g)).toHaveLength(1);
	});

	it('polls /api/state every 2 seconds', () => {
		expect(page).toContain('/api/state');
		expect(page).toContain('2000');
	});

	it('renders the lease badge and the body', () => {
		expect(page).toContain('id="lease-badge"');
		expect(page).toContain('<p>body</p>');
	});

	it('shows an escaped flash message', () => {
		const flashed = layout({
			title: 't',
			nonce: NONCE,
			lease: pausedLease,
			stateVersion: 'v',
			body: '',
			flash: '<b>ILLEGAL</b>',
		});
		expect(flashed).toContain('&lt;b&gt;ILLEGAL&lt;/b&gt;');
		expect(flashed).not.toContain('<b>ILLEGAL</b>');
	});
});

describe('interventionList', () => {
	const html = interventionList({
		requests: [takeoverRequest, approvalRequest],
		lease: pausedLease,
		formToken: FORM_TOKEN,
	});

	it('lists every request with a link to its detail, its kind, status and reason', () => {
		expect(html).toContain(`href="/interventions/${TAKEOVER_ID}"`);
		expect(html).toContain(`href="/interventions/${APPROVAL_ID}"`);
		expect(html).toContain('takeover');
		expect(html).toContain('approval');
		expect(html).toContain('target_unresolved');
		expect(html).toContain('member-lookup@1.0.0');
	});

	it('says so when there is nothing to do', () => {
		expect(interventionList({ requests: [], lease: pausedLease, formToken: FORM_TOKEN })).toMatch(
			/no intervention requests/i,
		);
	});

	it('offers Resume only while an operator holds the lease, and Abort until the lease is closed', () => {
		expect(buttons(html)).toEqual(['Abort']);
		expect(buttons(interventionList({ requests: [], lease: humanLease, formToken: FORM_TOKEN }))).toEqual([
			'Resume',
			'Abort',
		]);
		expect(
			buttons(interventionList({ requests: [], lease: { ...pausedLease, state: 'CLOSED' }, formToken: FORM_TOKEN })),
		).toEqual([]);
	});

	it('embeds the form token and the operator handle field (default ops-1)', () => {
		expect(html).toContain(`name="formToken" value="${FORM_TOKEN}"`);
		expect(html).toMatch(/name="operator"[^>]*value="ops-1"/);
		expect(html).toContain('pattern="[a-z0-9][a-z0-9._-]{0,63}"');
	});
});

describe('interventionDetail', () => {
	const detail = (request: InterventionRequest, lease = pausedLease, operator?: string) =>
		interventionDetail({ request, lease, formToken: FORM_TOKEN, ...(operator === undefined ? {} : { operator }) });

	it('shows the masked screenshot, the reason, the step and its risk, the subject, and the redacted url/title', () => {
		const html = detail(takeoverRequest);
		expect(html).toContain('<img src="/evidence/screenshot-0001"');
		expect(html).toContain('href="/evidence/a11y-snapshot-0001"');
		expect(html).toContain('target_unresolved');
		expect(html).toContain('Search button not found for member [REDACTED:memberId]');
		expect(html).toContain('Click Search');
		expect(html).toContain('s06-click-search');
		expect(html).toContain('read');
		expect(html).toContain('member-lookup@1.0.0');
		expect(html).toContain('http://127.0.0.1:4010/member?id=[REDACTED]');
		expect(html).toContain('CoreOne - Member [REDACTED]');
	});

	it('says when no screenshot was captured, and shows a goal subject', () => {
		const html = detail(approvalRequest);
		expect(html).not.toContain('<img');
		expect(html).toMatch(/no screenshot/i);
		expect(html).toContain('Open a savings sub-account for member {{memberId}}');
		expect(html).toContain('irreversible');
	});

	it('offers Take control on an open takeover while the lease is paused', () => {
		expect(buttons(detail(takeoverRequest))).toEqual(['Take control', 'Abort']);
	});

	it('offers Resume on a claimed takeover once the operator holds the lease', () => {
		expect(buttons(detail({ ...takeoverRequest, status: 'claimed' }, humanLease))).toEqual(['Resume', 'Abort']);
	});

	it('offers Approve and Reject on an open approval request', () => {
		expect(buttons(detail(approvalRequest))).toEqual(['Approve', 'Reject', 'Abort']);
	});

	it('only shows the options the request offers', () => {
		expect(buttons(detail({ ...approvalRequest, options: ['approve'] }))).toEqual(['Approve']);
		expect(buttons(detail({ ...takeoverRequest, options: ['resumed'] }))).toEqual(['Take control']);
	});

	it('offers nothing on a resolved request', () => {
		const resolved: InterventionRequest = {
			...approvalRequest,
			status: 'resolved',
			resolution: { decision: 'approve', by: 'operator:ops-1', at: '2026-09-29T10:21:00.000Z' },
		};
		const html = detail(resolved, { ...pausedLease, state: 'RESUMING' });
		expect(buttons(html)).toEqual([]);
		expect(html).toContain('approve');
		expect(html).toContain('operator:ops-1');
	});

	it('posts every action to its own route with the form token and the operator handle', () => {
		const html = detail(approvalRequest, pausedLease, 'ops-7');
		expect(html).toContain(`formaction="/interventions/${APPROVAL_ID}/approve"`);
		expect(html).toContain(`formaction="/interventions/${APPROVAL_ID}/reject"`);
		expect(html).toContain('formaction="/abort"');
		expect(html).toContain(`name="formToken" value="${FORM_TOKEN}"`);
		expect(html).toMatch(/name="operator"[^>]*value="ops-7"/);
		expect(html).toContain(`name="return" value="/interventions/${APPROVAL_ID}"`);
	});

	it('renders a <script> in the reason text inert (escaped)', () => {
		const hostile: InterventionRequest = {
			...takeoverRequest,
			reason: { code: 'target_unresolved', text: '<script>alert(1)</script>' },
			state: { ...takeoverRequest.state, title: '"><img src=x onerror=alert(1)>' },
		};
		const html = detail(hostile);
		expect(html).not.toContain('<script>alert(1)</script>');
		expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
		expect(html).not.toContain('<img src=x');
		expect(html).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
	});
});

describe('everything shown is already redacted', () => {
	it('never contains the session token or a raw value', () => {
		const pages = [
			interventionList({ requests: [takeoverRequest, approvalRequest], lease: pausedLease, formToken: FORM_TOKEN }),
			interventionDetail({ request: takeoverRequest, lease: pausedLease, formToken: FORM_TOKEN }),
			interventionDetail({ request: approvalRequest, lease: humanLease, formToken: FORM_TOKEN }),
		];
		for (const html of pages) {
			expect(html).not.toContain(TOKEN);
			// The fixture carries masked placeholders only; a concrete member id never appears.
			expect(html).not.toMatch(/\b\d{5}\b/);
		}
	});
});
