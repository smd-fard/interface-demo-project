import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { ControlClient, type LeaseView } from '@idp/session';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeControlFetch, PNG_BYTES, type FakeControl } from './fakeControlFetch.test-helper.js';
import { APPROVAL_ID, TAKEOVER_ID, TOKEN } from './fixtures.test-helper.js';
import { OperatorServer, SESSION_COOKIE } from './server.js';

const LOGIN_KEY = 'unitTestConsoleLoginKey'.repeat(2);

interface Reply {
	readonly status: number;
	readonly headers: IncomingHttpHeaders;
	readonly body: Buffer;
	readonly text: string;
}

describe('OperatorServer', () => {
	let control: FakeControl;
	let server: OperatorServer;
	let errors: unknown[];
	/** The `Cookie` header of the logged-in browser. */
	let cookie: string;
	const replies: Reply[] = [];

	beforeEach(async () => {
		control = fakeControlFetch();
		errors = [];
		const client = new ControlClient({ url: 'http://127.0.0.1:1', token: TOKEN, fetch: control.fetch });
		server = await OperatorServer.start({
			control: client,
			port: 0,
			loginKey: LOGIN_KEY,
			onError: (error) => errors.push(error),
		});
		const login = await send('GET', `/login?k=${LOGIN_KEY}`, { anonymous: true });
		cookie = String(login.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';
	});
	afterEach(async () => {
		await server.close();
		// The browser never sees the session token: not in a body, not in a header, not in a redirect.
		for (const reply of replies) {
			expect(reply.text).not.toContain(TOKEN);
			expect(JSON.stringify(reply.headers)).not.toContain(TOKEN);
		}
		replies.length = 0;
	});

	/** A raw HTTP request, so tests control every header (Host, Origin, Sec-Fetch-Site). */
	const send = (
		method: string,
		path: string,
		options: {
			readonly headers?: Record<string, string>;
			readonly body?: string;
			/** Without the session cookie. */
			readonly anonymous?: boolean;
		} = {},
	): Promise<Reply> =>
		new Promise((resolve, reject) => {
			const { port } = server.address();
			const headers = {
				host: `127.0.0.1:${port}`,
				...(options.anonymous === true ? {} : { cookie }),
				...options.headers,
			};
			const request = httpRequest({ host: '127.0.0.1', port, method, path, headers }, (response) => {
				const chunks: Buffer[] = [];
				response.on('data', (chunk: Buffer) => chunks.push(chunk));
				response.on('end', () => {
					const body = Buffer.concat(chunks);
					const reply = { status: response.statusCode ?? 0, headers: response.headers, body, text: body.toString() };
					replies.push(reply);
					resolve(reply);
				});
				response.on('error', reject);
			});
			request.on('error', reject);
			request.end(options.body);
		});

	const formTokenOf = async (): Promise<string> => {
		const page = await send('GET', '/');
		const match = /name="formToken" value="([0-9a-f]+)"/.exec(page.text);
		if (match?.[1] === undefined) throw new Error('no form token on the page');
		return match[1];
	};

	const post = async (
		path: string,
		fields: Record<string, string>,
		headers: Record<string, string> = {},
	): Promise<Reply> =>
		send('POST', path, {
			headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
			body: new URLSearchParams(fields).toString(),
		});

	const posts = () => control.calls.filter((call) => call.method === 'POST');

	describe('authentication (the console login key)', () => {
		it('login sets an HttpOnly SameSite=Strict session cookie and redirects to the list', async () => {
			expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=[0-9a-f]{64}$`));
			const again = await send('GET', `/login?k=${LOGIN_KEY}`, { anonymous: true });
			expect(again.status).toBe(401);
			expect(again.text).toContain('LOGIN_KEY_USED');
		});

		it('the Set-Cookie attributes', async () => {
			const fresh = await OperatorServer.start({
				control: new ControlClient({ url: 'http://127.0.0.1:1', token: TOKEN, fetch: control.fetch }),
				port: 0,
				loginKey: LOGIN_KEY,
			});
			try {
				const response = await fetch(`${fresh.url}/login?k=${LOGIN_KEY}`, { redirect: 'manual' });
				expect(response.status).toBe(303);
				expect(response.headers.get('location')).toBe('/');
				expect(response.headers.get('set-cookie')).toMatch(/; HttpOnly; SameSite=Strict; Path=\/$/);
			} finally {
				await fresh.close();
			}
		});

		it('every route but /login needs the session cookie (401 LOGIN_REQUIRED), without calling the session', async () => {
			const before = control.calls.length;
			for (const [method, path] of [
				['GET', '/'],
				['GET', '/api/state'],
				['GET', `/interventions/${TAKEOVER_ID}`],
				['GET', '/evidence/screenshot-0001'],
				['POST', `/interventions/${TAKEOVER_ID}/claim`],
				['POST', '/abort'],
			] as const) {
				const reply = await send(method, path, { anonymous: true });
				expect(reply.status).toBe(401);
				expect(reply.text).toContain('LOGIN_REQUIRED');
			}
			const forged = await send('GET', '/', {
				anonymous: true,
				headers: { cookie: `${SESSION_COOKIE}=${'0'.repeat(64)}` },
			});
			expect(forged.status).toBe(401);
			expect(control.calls.length).toBe(before);
		});

		it('a wrong login key is refused and sets no cookie', async () => {
			const reply = await send('GET', `/login?k=${'x'.repeat(LOGIN_KEY.length)}`, { anonymous: true });
			expect(reply.status).toBe(401);
			expect(reply.text).toContain('LOGIN_REJECTED');
			expect(reply.headers['set-cookie']).toBeUndefined();
		});
	});

	it('binds to 127.0.0.1 only, on an ephemeral port', () => {
		expect(server.address().address).toBe('127.0.0.1');
		expect(server.address().port).toBeGreaterThan(0);
		expect(server.url).toBe(`http://127.0.0.1:${server.address().port}`);
	});

	describe('GET /', () => {
		it('renders the list and the lease badge from the control API, calling it with the bearer token', async () => {
			const reply = await send('GET', '/');
			expect(reply.status).toBe(200);
			expect(reply.headers['content-type']).toBe('text/html; charset=utf-8');
			expect(reply.text).toContain(`href="/interventions/${TAKEOVER_ID}"`);
			expect(reply.text).toContain(`href="/interventions/${APPROVAL_ID}"`);
			expect(reply.text).toContain('data-state="PAUSED"');
			expect(control.calls.map((call) => `${call.method} ${call.path}`)).toEqual(
				expect.arrayContaining(['GET /lease', 'GET /interventions']),
			);
			for (const call of control.calls) expect(call.authorization).toBe(`Bearer ${TOKEN}`);
		});

		it('sends a restrictive CSP whose nonce is the one on the inline script', async () => {
			const reply = await send('GET', '/');
			const csp = String(reply.headers['content-security-policy']);
			expect(csp).toContain("default-src 'none'");
			expect(csp).toContain("form-action 'self'");
			expect(csp).toContain("frame-ancestors 'none'");
			expect(csp).toContain("base-uri 'none'");
			const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
			expect(nonce).toBeDefined();
			expect(reply.text).toContain(`<script nonce="${nonce}">`);
			expect(csp).not.toContain('unsafe-inline');
			const again = await send('GET', '/');
			expect(again.headers['content-security-policy']).not.toBe(csp);
			expect(reply.headers['x-content-type-options']).toBe('nosniff');
			expect(reply.headers['x-frame-options']).toBe('DENY');
			expect(reply.headers['referrer-policy']).toBe('no-referrer');
			expect(reply.headers['cache-control']).toBe('no-store');
		});

		it('shows a refused action as an escaped flash message, and ignores anything but an error code', async () => {
			expect((await send('GET', '/?error=ILLEGAL_LEASE_TRANSITION')).text).toContain('ILLEGAL_LEASE_TRANSITION');
			const hostile = await send('GET', `/?error=${encodeURIComponent('<script>x</script>')}`);
			expect(hostile.text).not.toContain('<script>x</script>');
			expect(hostile.text).not.toContain('class="flash"');
		});

		it('answers 502 with a clear page when the session is unreachable', async () => {
			control.unreachable = true;
			const reply = await send('GET', '/');
			expect(reply.status).toBe(502);
			expect(reply.text).toMatch(/session control API is unreachable/i);
		});
	});

	describe('GET /interventions/:id', () => {
		it('renders the detail of the request', async () => {
			const reply = await send('GET', `/interventions/${TAKEOVER_ID}`);
			expect(reply.status).toBe(200);
			expect(reply.text).toContain('<img src="/evidence/screenshot-0001"');
			expect(reply.text).toContain('Take control');
			expect(control.calls.some((call) => call.path === `/interventions/${TAKEOVER_ID}`)).toBe(true);
		});

		it('answers 404 for an unknown request, and for a malformed id without calling the session', async () => {
			expect((await send('GET', '/interventions/ir-20260929T000000-0000')).status).toBe(404);
			const before = control.calls.length;
			expect((await send('GET', '/interventions/..%2Flease')).status).toBe(404);
			expect(control.calls.length).toBe(before);
		});
	});

	describe('GET /evidence/:refId', () => {
		it('proxies the masked screenshot bytes', async () => {
			const reply = await send('GET', '/evidence/screenshot-0001');
			expect(reply.status).toBe(200);
			expect(reply.headers['content-type']).toBe('image/png');
			expect(new Uint8Array(reply.body)).toEqual(PNG_BYTES);
			expect(String(reply.headers['content-security-policy'])).toContain("default-src 'none'");
			expect(reply.headers['x-content-type-options']).toBe('nosniff');
		});

		it('proxies the redacted snapshot as JSON', async () => {
			const reply = await send('GET', '/evidence/a11y-snapshot-0001');
			expect(reply.status).toBe(200);
			expect(reply.headers['content-type']).toBe('application/json; charset=utf-8');
			expect(reply.text).toBe('{"role":"document"}\n');
		});

		it('passes on refusals and unknown evidence, and never serves another content type', async () => {
			expect((await send('GET', '/evidence/trace-0001')).status).toBe(403);
			expect((await send('GET', '/evidence/nothing-0001')).status).toBe(404);
			expect((await send('GET', '/evidence/html-0001')).status).toBe(502);
			const before = control.calls.length;
			expect((await send('GET', '/evidence/..%2F..%2Fetc')).status).toBe(404);
			expect(control.calls.length).toBe(before);
		});
	});

	describe('GET /api/state', () => {
		it('serves the lease and a summary of the requests with a version fingerprint', async () => {
			const reply = await send('GET', '/api/state');
			expect(reply.status).toBe(200);
			expect(reply.headers['content-type']).toBe('application/json; charset=utf-8');
			const state = JSON.parse(reply.text) as {
				lease: { state: string; holder: string };
				interventions: { id: string; status: string }[];
				version: string;
			};
			expect(state.lease).toEqual({ state: 'PAUSED', holder: 'none' });
			expect(state.interventions.map((request) => request.id)).toEqual([TAKEOVER_ID, APPROVAL_ID]);
			const page = await send('GET', '/');
			expect(page.text).toContain(`data-state-version="${state.version}"`);
		});
	});

	describe('POST actions', () => {
		it('claims through the control API and redirects back to the request', async () => {
			const formToken = await formTokenOf();
			const reply = await post(`/interventions/${TAKEOVER_ID}/claim`, {
				formToken,
				operator: 'ops-1',
				return: `/interventions/${TAKEOVER_ID}`,
			});
			expect(reply.status).toBe(303);
			expect(reply.headers.location).toBe(`/interventions/${TAKEOVER_ID}`);
			expect(posts()).toEqual([
				{
					method: 'POST',
					path: `/interventions/${TAKEOVER_ID}/claim`,
					authorization: `Bearer ${TOKEN}`,
					body: { operator: 'ops-1' },
				},
			]);
		});

		it.each(['approve', 'reject'])('%s goes to the control API', async (operation) => {
			const formToken = await formTokenOf();
			const reply = await post(`/interventions/${APPROVAL_ID}/${operation}`, { formToken, operator: 'ops-2' });
			expect(reply.status).toBe(303);
			expect(reply.headers.location).toBe(`/interventions/${APPROVAL_ID}`);
			expect(posts().map((call) => call.path)).toEqual([`/interventions/${APPROVAL_ID}/${operation}`]);
		});

		it.each(['resume', 'abort'])(
			'%s goes to the control API and returns to the given console page',
			async (operation) => {
				const formToken = await formTokenOf();
				const reply = await post(`/${operation}`, {
					formToken,
					operator: 'ops-1',
					return: `/interventions/${TAKEOVER_ID}`,
				});
				expect(reply.status).toBe(303);
				expect(reply.headers.location).toBe(`/interventions/${TAKEOVER_ID}`);
				expect(posts()).toEqual([
					{ method: 'POST', path: `/${operation}`, authorization: `Bearer ${TOKEN}`, body: { operator: 'ops-1' } },
				]);
			},
		);

		it.each(['https://evil.example/', '//evil.example', '/interventions/x/../../lease', 'javascript:alert(1)'])(
			'never redirects off the console (return=%s)',
			async (target) => {
				const formToken = await formTokenOf();
				const reply = await post('/resume', { formToken, operator: 'ops-1', return: target });
				expect(reply.headers.location).toBe('/');
			},
		);

		it('redirects back with the error code when the session refuses', async () => {
			const formToken = await formTokenOf();
			control.failNext = { status: 409, code: 'ILLEGAL_LEASE_TRANSITION' };
			const reply = await post('/resume', { formToken, operator: 'ops-1', return: '/' });
			expect(reply.status).toBe(303);
			expect(reply.headers.location).toBe('/?error=ILLEGAL_LEASE_TRANSITION');
		});

		it.each(['', 'Ops-1', 'ops 1', '-ops', 'a'.repeat(65)])(
			'refuses an invalid operator handle (%j) without calling the session',
			async (operator) => {
				const formToken = await formTokenOf();
				const reply = await post(`/interventions/${TAKEOVER_ID}/claim`, { formToken, operator });
				expect(reply.status).toBe(303);
				expect(reply.headers.location).toBe(`/interventions/${TAKEOVER_ID}?error=INVALID_OPERATOR`);
				expect(posts()).toEqual([]);
			},
		);
	});

	describe('CSRF protection', () => {
		it('rejects a POST without the form token', async () => {
			const reply = await post('/abort', { operator: 'ops-1' });
			expect(reply.status).toBe(403);
			expect(reply.text).toContain('CSRF_REJECTED');
			expect(posts()).toEqual([]);
		});

		it('rejects a POST with a wrong form token', async () => {
			const reply = await post('/abort', { formToken: 'a'.repeat(64), operator: 'ops-1' });
			expect(reply.status).toBe(403);
			expect(posts()).toEqual([]);
		});

		it('rejects a cross-origin POST even with the right token', async () => {
			const formToken = await formTokenOf();
			expect((await post('/abort', { formToken, operator: 'ops-1' }, { origin: 'http://evil.example' })).status).toBe(
				403,
			);
			expect((await post('/abort', { formToken, operator: 'ops-1' }, { 'sec-fetch-site': 'cross-site' })).status).toBe(
				403,
			);
			expect(posts()).toEqual([]);
		});

		it('accepts a same-origin POST', async () => {
			const formToken = await formTokenOf();
			const reply = await post('/abort', { formToken, operator: 'ops-1' }, { origin: server.url });
			expect(reply.status).toBe(303);
		});

		it('rejects a form that is not url-encoded, and an oversized body', async () => {
			const formToken = await formTokenOf();
			const json = await send('POST', '/abort', {
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ formToken, operator: 'ops-1' }),
			});
			expect(json.status).toBe(415);
			const big = await post('/abort', { formToken, operator: 'ops-1', pad: 'x'.repeat(20_000) });
			expect(big.status).toBe(413);
			expect(posts()).toEqual([]);
		});
	});

	it('rejects a foreign Host header (DNS rebinding) on every route', async () => {
		for (const path of ['/', '/api/state', '/evidence/screenshot-0001']) {
			const reply = await send('GET', path, { headers: { host: 'evil.example' } });
			expect(reply.status).toBe(421);
		}
		expect(control.calls).toEqual([]);
	});

	it('answers 404 to an unknown route and 405 to a wrong method', async () => {
		expect((await send('GET', '/nope')).status).toBe(404);
		expect((await send('GET', '/resume')).status).toBe(405);
		expect((await send('POST', '/')).status).toBe(405);
	});

	it('answers 500 without detail on an unexpected error, and reports it', async () => {
		class BrokenClient extends ControlClient {
			override lease(): Promise<LeaseView> {
				return Promise.reject(new RangeError(`boom ${TOKEN}`));
			}
		}
		const client = new BrokenClient({ url: 'http://127.0.0.1:1', token: TOKEN, fetch: control.fetch });
		const broken = await OperatorServer.start({
			control: client,
			port: 0,
			loginKey: LOGIN_KEY,
			onError: (error) => errors.push(error),
		});
		try {
			const login = await fetch(`${broken.url}/login?k=${LOGIN_KEY}`, { redirect: 'manual' });
			const session = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
			const response = await fetch(`${broken.url}/api/state`, { headers: { cookie: session } });
			const text = await response.text();
			replies.push({ status: response.status, headers: {}, body: Buffer.from(text), text });
			expect(response.status).toBe(500);
			expect(text).not.toContain('boom');
			expect(errors).toHaveLength(1);
		} finally {
			await broken.close();
		}
	});
});
