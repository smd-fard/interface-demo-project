import type { LeaseView } from '@idp/session';
import { escapeHtml } from './escapeHtml.js';
import { leaseBadge } from './leaseBadge.js';

/** The page shell input: title, CSP nonce, lease badge, polling fingerprint and body HTML. */
export interface LayoutInput {
	readonly title: string;
	/** The per-response CSP nonce; only the inline script and style carry it. */
	readonly nonce: string;
	readonly lease: Pick<LeaseView, 'state' | 'holder'>;
	/** A fingerprint of the lease and the request list; the page reloads when `/api/state` reports another. */
	readonly stateVersion: string;
	readonly body: string;
	/** A one-line message (e.g. the error code of a refused action). */
	readonly flash?: string;
}

/** Polls `/api/state` every 2 s: refreshes the lease badge and reloads when the lease or the list changed. */
const POLLING_SCRIPT = `(() => {
	const KEY = 'idp-operator-handle';
	const HANDLE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
	const field = document.getElementById('operator');
	if (field) {
		try {
			const saved = sessionStorage.getItem(KEY);
			if (saved && HANDLE.test(saved)) field.value = saved;
		} catch (error) {
			console.warn('operator console: session storage unavailable', error);
		}
		field.addEventListener('input', () => {
			try {
				sessionStorage.setItem(KEY, field.value);
			} catch (error) {
				console.warn('operator console: session storage unavailable', error);
			}
		});
	}
	const version = document.body.dataset.stateVersion;
	const poll = async () => {
		try {
			const response = await fetch('/api/state', { cache: 'no-store', headers: { accept: 'application/json' } });
			if (response.ok) {
				const state = await response.json();
				const badge = document.getElementById('lease-badge');
				if (badge) {
					badge.dataset.state = state.lease.state;
					badge.querySelector('strong').textContent = state.lease.state;
					badge.querySelector('.holder').textContent = state.lease.holder;
				}
				if (state.version !== version) {
					location.reload();
					return;
				}
			}
		} catch (error) {
			console.warn('operator console: polling failed; retrying', error);
		}
		setTimeout(poll, 2000);
	};
	setTimeout(poll, 2000);
})();`;

const STYLE = `
	body { font: 14px/1.4 system-ui, sans-serif; margin: 0; color: #1d1d1f; background: #fafafa; }
	header, main { padding: 12px 20px; }
	header { background: #fff; border-bottom: 1px solid #ddd; display: flex; gap: 16px; align-items: center; }
	.banner { background: #fff4d6; border-bottom: 1px solid #e6c65c; padding: 8px 20px; }
	.flash { background: #fde2e2; border: 1px solid #e08a8a; padding: 8px; }
	.lease { padding: 2px 8px; border-radius: 10px; background: #eee; }
	.lease[data-state="PAUSED"] { background: #ffe8a8; }
	.lease[data-state="HUMAN"] { background: #c9e4ff; }
	.lease[data-state="CLOSED"] { background: #ddd; }
	table { border-collapse: collapse; width: 100%; background: #fff; }
	th, td { text-align: left; border-bottom: 1px solid #eee; padding: 6px 8px; vertical-align: top; }
	dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; }
	dt { font-weight: 600; }
	.risk-irreversible { color: #a40000; font-weight: 600; }
	.screenshot { max-width: 100%; border: 1px solid #ccc; }
	form.actions { margin: 12px 0; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
`;

/**
 * The console page shell: the "deliberately mocked" banner, the lease badge, an optional flash message, the
 * page body and the polling script. Inline script and style carry the CSP nonce.
 */
export function layout(input: LayoutInput): string {
	const nonce = escapeHtml(input.nonce);
	return [
		'<!doctype html>',
		'<html lang="en">',
		'<head>',
		'<meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		`<title>${escapeHtml(input.title)} · IDP operator console</title>`,
		`<style nonce="${nonce}">${STYLE}</style>`,
		'</head>',
		`<body data-state-version="${escapeHtml(input.stateVersion)}">`,
		'<div class="banner" role="note">This is a deliberately mocked operator console: just enough to claim, approve,',
		'resume and abort over the session control API. The real operator product is a design, not code here; see',
		'<a href="REPORT.md#5">REPORT §5</a>.</div>',
		`<header><strong>IDP operator console</strong> ${leaseBadge(input.lease)}</header>`,
		'<main>',
		input.flash === undefined ? '' : `<p class="flash" role="alert">${escapeHtml(input.flash)}</p>`,
		input.body,
		'</main>',
		`<script nonce="${nonce}">${POLLING_SCRIPT}</script>`,
		'</body>',
		'</html>',
	].join('\n');
}
