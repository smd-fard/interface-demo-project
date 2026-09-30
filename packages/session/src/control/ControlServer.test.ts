import { FakeRandom } from '@idp/evidence/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ControlServer } from './ControlServer.js';
import type { ControlTarget } from './ControlTarget.js';
import { fakeControlTarget, REQUEST_ID } from './fakeControlTarget.test-helper.js';

describe('ControlServer', () => {
	let target: ControlTarget & { readonly calls: string[] };
	let server: ControlServer;

	beforeEach(async () => {
		target = await fakeControlTarget();
		server = await ControlServer.start({ target, port: 0 });
	});
	afterEach(async () => {
		await server.close();
	});

	const call = (route: string, init: RequestInit & { readonly token?: string | null } = {}) => {
		const { token = server.token, ...rest } = init;
		return fetch(`${server.url}${route}`, {
			...rest,
			headers: {
				...(token === null ? {} : { authorization: `Bearer ${token}` }),
				...(rest.body === undefined ? {} : { 'content-type': 'application/json' }),
			},
		});
	};
	const post = (route: string, body: unknown, token?: string | null) =>
		call(route, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), token });
	const errorOf = async (response: Response) => ((await response.json()) as { error: { code: string } }).error.code;

	it('binds to 127.0.0.1 only, on an ephemeral port', () => {
		expect(server.address().address).toBe('127.0.0.1');
		expect(server.address().port).toBeGreaterThan(0);
		expect(server.url).toBe(`http://127.0.0.1:${server.address().port}`);
	});

	it('generates a per-session bearer token of at least 32 hex characters', async () => {
		expect(server.token).toMatch(/^[0-9a-f]{32,}$/);
		const other = await ControlServer.start({ target, port: 0 });
		try {
			expect(other.token).not.toBe(server.token);
		} finally {
			await other.close();
		}
	});

	it('uses the injected randomness for the token', async () => {
		const seeded = await ControlServer.start({ target, port: 0, random: new FakeRandom(['ab'.repeat(32)]) });
		try {
			expect(seeded.token).toBe('ab'.repeat(32));
		} finally {
			await seeded.close();
		}
	});

	it.each([
		['no token', null],
		['a wrong token', 'f'.repeat(64)],
		['a token of another length', 'abc'],
	])('answers 401 to %s, on every route, without touching the session', async (_label, token) => {
		for (const response of [
			await call('/lease', { token }),
			await call('/interventions', { token }),
			await call('/evidence/screenshot-0001', { token }),
			await post(`/interventions/${REQUEST_ID}/claim`, { operator: 'ops-1' }, token),
			await post('/abort', { operator: 'ops-1' }, token),
		]) {
			expect(response.status).toBe(401);
			expect(await errorOf(response)).toBe('UNAUTHORIZED');
		}
		expect(target.calls).toEqual([]);
	});

	it('GET /lease serves state, holder and history', async () => {
		const response = await call('/lease');
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			state: 'PAUSED',
			holder: 'none',
			history: [{ from: 'AGENT', to: 'PAUSED', actor: 'replay', requestId: REQUEST_ID }],
		});
	});

	it('GET /interventions and /interventions/:id serve the requests; an unknown id is 404', async () => {
		const list = await call('/interventions');
		expect(list.status).toBe(200);
		expect(((await list.json()) as { id: string }[]).map((r) => r.id)).toEqual([REQUEST_ID]);
		const one = await call(`/interventions/${REQUEST_ID}`);
		expect(await one.json()).toMatchObject({ id: REQUEST_ID, status: 'open' });
		const missing = await call('/interventions/ir-20260929T101500-dead');
		expect(missing.status).toBe(404);
		expect(await errorOf(missing)).toBe('NOT_FOUND');
	});

	it('GET /evidence serves masked screenshots, redacted snapshots and intervention documents only', async () => {
		const png = await call('/evidence/screenshot-0001');
		expect(png.status).toBe(200);
		expect(png.headers.get('content-type')).toBe('image/png');
		expect(new Uint8Array(await png.arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
		const snapshot = await call('/evidence/a11y-snapshot-0001');
		expect(snapshot.headers.get('content-type')).toContain('application/json');
		expect(await snapshot.json()).toEqual({ role: 'document' });
		expect((await call('/evidence/json-0001')).status).toBe(200);

		for (const refused of ['trace-0001', 'json-0002']) {
			const response = await call(`/evidence/${refused}`);
			expect(response.status).toBe(403);
			expect(await errorOf(response)).toBe('EVIDENCE_NOT_SHAREABLE');
		}
		expect((await call('/evidence/screenshot-0099')).status).toBe(404);
	});

	it('POST claim → HUMAN, then resume → RESUMING, with the operator as "operator:<handle>"', async () => {
		const claim = await post(`/interventions/${REQUEST_ID}/claim`, { operator: 'ops-1' });
		expect(claim.status).toBe(200);
		expect(await claim.json()).toMatchObject({ id: REQUEST_ID, status: 'claimed' });
		const resume = await post('/resume', { operator: 'ops-1' });
		expect(resume.status).toBe(200);
		expect(await resume.json()).toMatchObject({ state: 'RESUMING', holder: 'none' });
		expect(target.calls).toEqual([`claim ${REQUEST_ID} operator:ops-1`, 'resume operator:ops-1']);
	});

	it('answers 409 to an illegal lease transition (resume while PAUSED) and to a wrong request kind', async () => {
		const resume = await post('/resume', { operator: 'ops-1' });
		expect(resume.status).toBe(409);
		expect(await errorOf(resume)).toBe('ILLEGAL_LEASE_TRANSITION');
		const approve = await post(`/interventions/${REQUEST_ID}/approve`, { operator: 'ops-1' });
		expect(approve.status).toBe(409);
		expect(await errorOf(approve)).toBe('INTERVENTION_CONFLICT');
	});

	it('answers 404 to an operation on an unknown request', async () => {
		const response = await post('/interventions/ir-20260929T101500-dead/reject', { operator: 'ops-1' });
		expect(response.status).toBe(404);
		expect(await errorOf(response)).toBe('INTERVENTION_NOT_FOUND');
	});

	it.each([
		['no body', undefined],
		['malformed JSON', '{"operator":'],
		['a non-object', '[1]'],
		['no operator', {}],
		['an empty operator', { operator: '' }],
		['an operator that is not a handle', { operator: 'Jane Sample' }],
		['an operator with a prefix', { operator: 'operator:ops-1' }],
		['an unknown field', { operator: 'ops-1', extra: true }],
	])('answers 400 to %s, without touching the session', async (_label, body) => {
		const response =
			body === undefined ? await call('/abort', { method: 'POST' }) : await post('/abort', body as unknown);
		expect(response.status).toBe(400);
		expect(await errorOf(response)).toBe('BAD_REQUEST');
		expect(target.calls).toEqual([]);
	});

	it('answers 413 to an oversized body', async () => {
		const response = await post('/abort', { operator: 'ops-1', pad: 'x'.repeat(40_000) });
		expect(response.status).toBe(413);
		expect(target.calls).toEqual([]);
	});

	it('answers 404 to an unknown route and 405 to a wrong method', async () => {
		expect((await call('/nope')).status).toBe(404);
		const wrong = await call('/lease', { method: 'DELETE' });
		expect(wrong.status).toBe(405);
		expect(await errorOf(wrong)).toBe('METHOD_NOT_ALLOWED');
		expect((await call('/resume')).status).toBe(405);
	});

	it('answers 500 without detail to an unexpected error, and keeps the error for the session', async () => {
		const failing = await ControlServer.start({
			target: {
				...target,
				lease: () => {
					throw new Error('secret 12345');
				},
			},
			port: 0,
		});
		try {
			const response = await fetch(`${failing.url}/lease`, { headers: { authorization: `Bearer ${failing.token}` } });
			expect(response.status).toBe(500);
			const text = await response.text();
			expect(text).not.toContain('12345');
			expect(failing.errors).toHaveLength(1);
		} finally {
			await failing.close();
		}
	});

	it('POST /abort closes the lease', async () => {
		const response = await post('/abort', { operator: 'ops-2' });
		expect(await response.json()).toMatchObject({ state: 'CLOSED' });
	});
});
