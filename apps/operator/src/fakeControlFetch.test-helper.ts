import type { InterventionRequest } from '@idp/artifact-schema';
import type { LeaseView } from '@idp/session';
import { approvalRequest, pausedLease, takeoverRequest } from './fixtures.test-helper.js';

export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

export interface ControlCall {
	readonly method: string;
	readonly path: string;
	readonly authorization: string | null;
	readonly body?: unknown;
}

export interface FakeControl {
	readonly fetch: typeof fetch;
	readonly calls: ControlCall[];
	lease: LeaseView;
	requests: InterventionRequest[];
	/** The next call answers this error instead. */
	failNext?: { readonly status: number; readonly code: string };
	/** Every call rejects as a network failure. */
	unreachable: boolean;
}

const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const error = (status: number, code: string) => json(status, { error: { code, message: `fake ${code}` } });

/**
 * A fake of the session's control API behind `fetch`, for a real `ControlClient`: the operator server holds
 * the client (and so the token) exactly as in production, and the calls it makes are recorded.
 */
export function fakeControlFetch(): FakeControl {
	const control: FakeControl = {
		calls: [],
		lease: pausedLease,
		requests: [takeoverRequest, approvalRequest],
		unreachable: false,
		fetch: async (input, init) => {
			const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
			const method = init?.method ?? 'GET';
			const headers = new Headers(init?.headers);
			const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
			control.calls.push({
				method,
				path: url.pathname,
				authorization: headers.get('authorization'),
				...(body === undefined ? {} : { body }),
			});
			if (control.unreachable) throw new TypeError('fetch failed');
			if (control.failNext !== undefined) {
				const { status, code } = control.failNext;
				delete control.failNext;
				return error(status, code);
			}
			const find = (id: string) => control.requests.find((request) => request.id === id);
			const replace = (next: InterventionRequest) => {
				control.requests = control.requests.map((request) => (request.id === next.id ? next : request));
				return json(200, next);
			};
			const path = url.pathname;
			let match: RegExpExecArray | null;
			if (method === 'GET' && path === '/lease') return json(200, control.lease);
			if (method === 'GET' && path === '/interventions') return json(200, control.requests);
			if (method === 'GET' && (match = /^\/interventions\/([^/]+)$/.exec(path)) !== null) {
				const request = find(decodeURIComponent(match[1] ?? ''));
				return request === undefined ? error(404, 'NOT_FOUND') : json(200, request);
			}
			if (method === 'GET' && (match = /^\/evidence\/([^/]+)$/.exec(path)) !== null) {
				const id = match[1];
				if (id === 'screenshot-0001') return new Response(PNG_BYTES, { headers: { 'content-type': 'image/png' } });
				if (id === 'a11y-snapshot-0001') {
					return new Response('{"role":"document"}\n', {
						headers: { 'content-type': 'application/json; charset=utf-8' },
					});
				}
				if (id === 'trace-0001') return error(403, 'EVIDENCE_NOT_SHAREABLE');
				if (id === 'html-0001') return new Response('<script>x</script>', { headers: { 'content-type': 'text/html' } });
				return error(404, 'NOT_FOUND');
			}
			if (method === 'POST' && (match = /^\/interventions\/([^/]+)\/(claim|approve|reject)$/.exec(path)) !== null) {
				const request = find(decodeURIComponent(match[1] ?? ''));
				if (request === undefined) return error(404, 'INTERVENTION_NOT_FOUND');
				const by = `operator:${(body as { operator: string }).operator}` as const;
				const at = '2026-09-29T10:30:00.000Z';
				if (match[2] === 'claim') {
					control.lease = { state: 'HUMAN', holder: 'human', history: [] };
					return replace({ ...request, status: 'claimed' });
				}
				const decision = match[2] === 'approve' ? 'approve' : 'reject';
				control.lease = { state: decision === 'approve' ? 'RESUMING' : 'CLOSED', holder: 'none', history: [] };
				return replace({ ...request, status: 'resolved', resolution: { decision, by, at } });
			}
			if (method === 'POST' && path === '/resume') {
				control.lease = { state: 'RESUMING', holder: 'none', history: [] };
				return json(200, control.lease);
			}
			if (method === 'POST' && path === '/abort') {
				control.lease = { state: 'CLOSED', holder: 'none', history: [] };
				return json(200, control.lease);
			}
			return error(404, 'NOT_FOUND');
		},
	};
	return control;
}
