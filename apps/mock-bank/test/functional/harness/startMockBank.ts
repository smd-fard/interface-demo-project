import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../dist/main.js');

/** A running mock-bank process started from the built `dist/main.js`. */
export interface RunningMockBank {
	/** Base URL, e.g. `http://127.0.0.1:53211`. */
	readonly url: string;
	/** Absolute URL for a path on the app. */
	at(pathname: string): string;
	/** `POST /__admin/faults` with the given JSON body. */
	setFault(fault: { code: string; mode?: 'once' | 'always'; route?: string; delayMs?: number }): Promise<void>;
	/** `DELETE /__admin/faults`. */
	clearFaults(): Promise<void>;
	/** `POST /__admin/reset`. */
	reset(): Promise<void>;
	stop(): Promise<void>;
}

/** Spawns `node dist/main.js` on an ephemeral port and resolves once it prints `listening <url>`. */
export async function startMockBank(env: Record<string, string> = {}): Promise<RunningMockBank> {
	const child = spawn(process.execPath, [MAIN], {
		env: { ...process.env, MOCKBANK_PORT: '0', MOCKBANK_HOST: '127.0.0.1', ...env },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	const url = await waitForListening(child);
	const at = (pathname: string): string => new URL(pathname, url).toString();

	async function admin(method: string, pathname: string, body?: unknown): Promise<void> {
		const response = await fetch(at(pathname), {
			method,
			headers: body === undefined ? {} : { 'content-type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		if (!response.ok) throw new Error(`${method} ${pathname} → ${response.status} ${await response.text()}`);
	}

	return {
		url,
		at,
		setFault: (fault) => admin('POST', '/__admin/faults', fault),
		clearFaults: () => admin('DELETE', '/__admin/faults'),
		reset: () => admin('POST', '/__admin/reset'),
		stop: () => stopChild(child),
	};
}

function waitForListening(child: ChildProcess): Promise<string> {
	return new Promise((resolve, reject) => {
		let out = '';
		let err = '';
		const timer = setTimeout(() => reject(new Error(`mock-bank did not start: ${out}${err}`)), 15_000);
		child.stdout?.on('data', (chunk: Buffer) => {
			out += chunk.toString();
			const match = /listening (\S+)/.exec(out);
			if (match?.[1]) {
				clearTimeout(timer);
				resolve(match[1]);
			}
		});
		child.stderr?.on('data', (chunk: Buffer) => {
			err += chunk.toString();
		});
		child.on('exit', (code) => {
			clearTimeout(timer);
			reject(new Error(`mock-bank exited with ${code}: ${out}${err}`));
		});
	});
}

function stopChild(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null) return Promise.resolve();
	return new Promise((resolve) => {
		child.once('exit', () => resolve());
		child.kill('SIGTERM');
	});
}
