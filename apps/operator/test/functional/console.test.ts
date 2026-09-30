import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ControlClient, ControlServer } from '@idp/session';
import { afterEach, describe, expect, it } from 'vitest';
import { OperatorServer } from '../../src/server.js';
import { fakeSessionTarget, SCREENSHOT_BYTES, type FakeSessionTarget } from './fakeSessionTarget.js';

const MAIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/main.js');

interface ConsoleUnderTest {
	readonly target: FakeSessionTarget;
	readonly control: ControlServer;
	readonly operator: OperatorServer;
	readonly bodies: string[];
}

describe('operator console over a real ControlServer', () => {
	const running: ConsoleUnderTest[] = [];

	afterEach(async () => {
		for (const { target, control, operator, bodies } of running.splice(0)) {
			await operator.close();
			await control.close();
			await target.dispose();
			expect(control.errors).toEqual([]);
			expect(operator.errors).toEqual([]);
			// The session token never reaches the browser.
			for (const body of bodies) expect(body).not.toContain(control.token);
		}
	});

	const start = async (kind: 'takeover' | 'approval'): Promise<ConsoleUnderTest> => {
		const target = await fakeSessionTarget(kind);
		const control = await ControlServer.start({ target, port: 0 });
		const operator = await OperatorServer.start({
			control: new ControlClient({ url: control.url, token: control.token }),
			port: 0,
		});
		const started = { target, control, operator, bodies: [] };
		running.push(started);
		return started;
	};

	const get = async (app: ConsoleUnderTest, route: string): Promise<Response & { readonly text: string }> => {
		const response = await fetch(`${app.operator.url}${route}`);
		const text = await response.clone().text();
		app.bodies.push(text, JSON.stringify([...response.headers]));
		return Object.assign(response, { text });
	};

	const formToken = async (app: ConsoleUnderTest): Promise<string> => {
		const match = /name="formToken" value="([0-9a-f]+)"/.exec((await get(app, '/')).text);
		if (match?.[1] === undefined) throw new Error('no form token on the page');
		return match[1];
	};

	/** A form post as the browser sends it (same origin), without following the redirect. */
	const post = async (app: ConsoleUnderTest, route: string, fields: Record<string, string>): Promise<Response> => {
		const response = await fetch(`${app.operator.url}${route}`, {
			method: 'POST',
			redirect: 'manual',
			headers: { 'content-type': 'application/x-www-form-urlencoded', origin: app.operator.url },
			body: new URLSearchParams({ formToken: await formToken(app), operator: 'ops-1', ...fields }).toString(),
		});
		app.bodies.push(await response.clone().text(), JSON.stringify([...response.headers]));
		return response;
	};

	it('claims a takeover and resumes it, round-tripping through the session', async () => {
		const app = await start('takeover');
		const id = app.target.request().id;

		const list = await get(app, '/');
		expect(list.status).toBe(200);
		expect(list.text).toContain(`href="/interventions/${id}"`);
		expect(list.text).toContain('data-state="PAUSED"');

		const claimed = await post(app, `/interventions/${id}/claim`, { return: `/interventions/${id}` });
		expect(claimed.status).toBe(303);
		expect(claimed.headers.get('location')).toBe(`/interventions/${id}`);
		expect(app.target.lease().state).toBe('HUMAN');
		expect(app.target.request().status).toBe('claimed');

		const detail = await get(app, `/interventions/${id}`);
		expect(detail.text).toContain('data-state="HUMAN"');
		expect(detail.text).toContain('>Resume</button>');

		const resumed = await post(app, '/resume', { return: `/interventions/${id}` });
		expect(resumed.status).toBe(303);
		expect(resumed.headers.get('location')).toBe(`/interventions/${id}`);
		expect(app.target.lease().state).toBe('RESUMING');
		expect(app.target.calls).toEqual([`claim ${id} operator:ops-1`, 'resume operator:ops-1']);

		const state = (await (await get(app, '/api/state')).json()) as { lease: { state: string } };
		expect(state.lease.state).toBe('RESUMING');
	});

	it('approves an approval request', async () => {
		const app = await start('approval');
		const id = app.target.request().id;

		const detail = await get(app, `/interventions/${id}`);
		expect(detail.text).toContain('>Approve</button>');
		expect(detail.text).toContain('irreversible');

		const approved = await post(app, `/interventions/${id}/approve`, {});
		expect(approved.status).toBe(303);
		expect(app.target.lease().state).toBe('RESUMING');
		expect(app.target.request().resolution).toMatchObject({ decision: 'approve', by: 'operator:ops-1' });
		expect(app.target.calls).toEqual([`approve ${id} operator:ops-1`]);
	});

	it('shows the session refusal of an illegal transition', async () => {
		const app = await start('takeover');
		const refused = await post(app, '/resume', { return: '/' });
		expect(refused.status).toBe(303);
		expect(refused.headers.get('location')).toBe('/?error=ILLEGAL_LEASE_TRANSITION');
		expect(app.target.lease().state).toBe('PAUSED');
		expect((await get(app, '/?error=ILLEGAL_LEASE_TRANSITION')).text).toContain('ILLEGAL_LEASE_TRANSITION');
	});

	it('streams the masked screenshot bytes through the evidence proxy', async () => {
		const app = await start('takeover');
		const response = await fetch(`${app.operator.url}/evidence/screenshot-0001`);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/png');
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(SCREENSHOT_BYTES);
		expect((await get(app, '/evidence/screenshot-0002')).status).toBe(404);
	});

	it('refuses a form post without the form token, leaving the session untouched', async () => {
		const app = await start('takeover');
		const response = await fetch(`${app.operator.url}/abort`, {
			method: 'POST',
			redirect: 'manual',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: 'operator=ops-1',
		});
		expect(response.status).toBe(403);
		expect(app.target.calls).toEqual([]);
		expect(app.target.lease().state).toBe('PAUSED');
	});
});

describe('operator console process (dist/main.js)', () => {
	const run = (env: Record<string, string>) =>
		spawn(process.execPath, [MAIN], {
			env: { PATH: process.env['PATH'] ?? '', ...env },
			stdio: ['ignore', 'pipe', 'pipe'],
		});

	it('exits 64 with a clear message when the control URL or token is missing', async () => {
		const child = run({ IDP_CONTROL_URL: 'http://127.0.0.1:1' });
		let stderr = '';
		child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
		const [code] = (await once(child, 'exit')) as [number | null];
		expect(code).toBe(64);
		expect(stderr).toContain('IDP_CONTROL_TOKEN');
	});

	it('prints its URL (never the token) and serves the console', async () => {
		const target = await fakeSessionTarget('takeover');
		const control = await ControlServer.start({ target, port: 0 });
		const child = run({ IDP_CONTROL_URL: control.url, IDP_CONTROL_TOKEN: control.token, IDP_OPERATOR_PORT: '0' });
		try {
			let stdout = '';
			const url = await new Promise<string>((resolve, reject) => {
				child.stdout.on('data', (chunk: Buffer) => {
					stdout += chunk.toString();
					const match = /operator console at (http:\/\/127\.0\.0\.1:\d+)/.exec(stdout);
					if (match?.[1] !== undefined) resolve(match[1]);
				});
				child.once('exit', (code) => reject(new Error(`operator exited early with ${String(code)}`)));
			});
			expect(stdout).not.toContain(control.token);
			const response = await fetch(`${url}/api/state`);
			expect(response.status).toBe(200);
			expect(((await response.json()) as { lease: { state: string } }).lease.state).toBe('PAUSED');
		} finally {
			child.kill('SIGTERM');
			await once(child, 'exit');
			await control.close();
			await target.dispose();
		}
	});
});
