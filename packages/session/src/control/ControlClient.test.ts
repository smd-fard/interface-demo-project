import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ControlClient } from './ControlClient.js';
import { ControlServer } from './ControlServer.js';
import { fakeControlTarget, REQUEST_ID } from './fakeControlTarget.test-helper.js';
import { ControlApiError } from '../errors/ControlApiError.js';

describe('ControlClient', () => {
	let server: ControlServer;
	let client: ControlClient;

	beforeEach(async () => {
		server = await ControlServer.start({ target: await fakeControlTarget(), port: 0 });
		client = new ControlClient({ url: server.url, token: server.token });
	});
	afterEach(async () => {
		await server.close();
	});

	it('reads the lease and the interventions, validated against the contracts', async () => {
		expect(await client.lease()).toMatchObject({ state: 'PAUSED', holder: 'none', history: [{ to: 'PAUSED' }] });
		expect((await client.interventions()).map((request) => request.id)).toEqual([REQUEST_ID]);
		expect(await client.intervention(REQUEST_ID)).toMatchObject({ kind: 'takeover', status: 'open' });
	});

	it('claims and resumes with an operator handle', async () => {
		expect(await client.claim(REQUEST_ID, 'ops-1')).toMatchObject({ status: 'claimed' });
		expect((await client.lease()).state).toBe('HUMAN');
		expect(await client.resume('ops-1')).toMatchObject({ state: 'RESUMING' });
		expect(await client.intervention(REQUEST_ID)).toMatchObject({
			status: 'resolved',
			resolution: { decision: 'resumed', by: 'operator:ops-1' },
		});
	});

	it('fetches shareable evidence bytes with their content type', async () => {
		const evidence = await client.evidence('screenshot-0001');
		expect(evidence.contentType).toBe('image/png');
		expect(evidence.bytes).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
	});

	it('turns an API error into ControlApiError with the status and the server code', async () => {
		const error = await client.resume('ops-1').catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(ControlApiError);
		expect(error).toMatchObject({ code: 'CONTROL_API_ERROR', status: 409, apiCode: 'ILLEGAL_LEASE_TRANSITION' });
		await expect(client.evidence('trace-0001')).rejects.toMatchObject({ status: 403 });
		await expect(client.intervention('ir-20260929T101500-dead')).rejects.toMatchObject({ status: 404 });
	});

	it('a wrong token is a 401 ControlApiError', async () => {
		const stranger = new ControlClient({ url: server.url, token: 'f'.repeat(64) });
		await expect(stranger.lease()).rejects.toMatchObject({ status: 401, apiCode: 'UNAUTHORIZED' });
	});

	it('rejects a response that does not match the contract', async () => {
		const liar = new ControlClient({
			url: server.url,
			token: server.token,
			fetch: async () => new Response(JSON.stringify({ state: 'SLEEPING' }), { status: 200 }),
		});
		await expect(liar.lease()).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
	});

	it('refuses a malformed operator handle before sending anything', async () => {
		let sent = 0;
		const counting = new ControlClient({
			url: server.url,
			token: server.token,
			fetch: async () => {
				sent += 1;
				return new Response('{}');
			},
		});
		await expect(counting.claim(REQUEST_ID, 'Jane Sample')).rejects.toMatchObject({ code: 'SESSION_VALIDATION' });
		expect(sent).toBe(0);
	});
});
