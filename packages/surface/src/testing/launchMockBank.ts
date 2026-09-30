import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MockBankStartError } from './MockBankStartError.js';

/** Options for a mock-bank process. Every value maps to one `MOCKBANK_*` environment variable. */
export interface MockBankOptions {
	/** `MOCKBANK_TENANT` (default `a`). */
	readonly tenant?: 'a' | 'b';
	/** `MOCKBANK_FAULTS`: faults active from start, in the mock-bank's own format. */
	readonly faults?: string;
	/** `MOCKBANK_SLOW_MS`: the delay of the `slow_load` fault. */
	readonly slowMs?: number;
	/** `MOCKBANK_SESSION_IDLE_MS`: the session idle timeout. */
	readonly sessionIdleMs?: number;
	/** Upper bound for start-up (default 15 000 ms). */
	readonly startTimeoutMs?: number;
}

/** Options for `setFault`, sent as JSON to `POST /__admin/faults`. */
export interface FaultOptions {
	/** Omitted = the mock-bank's default for the code. */
	readonly mode?: 'once' | 'always';
	readonly route?: string;
	readonly delayMs?: number;
}

/** A running mock-bank process on a free port. */
export interface MockBank {
	/** E.g. `http://127.0.0.1:53211`. */
	readonly origin: string;
	setFault(code: string, options?: FaultOptions): Promise<void>;
	clearFaults(): Promise<void>;
	/** Resets the server's in-memory state (sessions, sequences, faults). */
	reset(): Promise<void>;
	stop(): Promise<void>;
}

/** The origin in a `listening <url>` line, or `null`. */
export function parseListeningLine(line: string): string | null {
	const url = /listening (https?:\/\/\S+)/.exec(line)?.[1];
	if (url === undefined) return null;
	try {
		return new URL(url).origin;
	} catch {
		return null;
	}
}

/** The monorepo root: the nearest ancestor of `fromUrl` holding `pnpm-workspace.yaml`. */
export function findRepoRoot(fromUrl: string): string {
	let dir = path.dirname(fileURLToPath(fromUrl));
	for (;;) {
		if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) throw new MockBankStartError(`no pnpm-workspace.yaml above ${fromUrl}`);
		dir = parent;
	}
}

async function admin(origin: string, method: string, route: string, body?: unknown): Promise<void> {
	const response = await fetch(`${origin}${route}`, {
		method,
		...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
	});
	if (!response.ok) throw new MockBankStartError(`${method} ${route} answered ${response.status}`);
}

async function waitForHealth(origin: string, deadline: number): Promise<void> {
	for (;;) {
		try {
			const response = await fetch(`${origin}/__health`);
			if (response.ok) return;
		} catch {
			// not accepting connections yet
		}
		if (Date.now() > deadline) throw new MockBankStartError(`${origin}/__health did not answer in time`);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

/**
 * Starts `apps/mock-bank/dist/main.js` as a separate process (nothing imports the package: the target is a
 * black box over HTTP) on a free port, waits for `/__health`, and returns its admin helpers. Build the
 * mock-bank first: `pnpm --filter @idp/mock-bank build`.
 */
export async function launchMockBank(options: MockBankOptions = {}): Promise<MockBank> {
	const main = path.join(findRepoRoot(import.meta.url), 'apps', 'mock-bank', 'dist', 'main.js');
	if (!existsSync(main)) {
		throw new MockBankStartError(`${main} not found: run \`pnpm --filter @idp/mock-bank build\``);
	}
	const env: NodeJS.ProcessEnv = {
		...process.env,
		MOCKBANK_PORT: '0',
		MOCKBANK_TENANT: options.tenant ?? 'a',
		...(options.faults === undefined ? {} : { MOCKBANK_FAULTS: options.faults }),
		...(options.slowMs === undefined ? {} : { MOCKBANK_SLOW_MS: String(options.slowMs) }),
		...(options.sessionIdleMs === undefined ? {} : { MOCKBANK_SESSION_IDLE_MS: String(options.sessionIdleMs) }),
	};
	const child = spawn(process.execPath, [main], { env, stdio: ['ignore', 'pipe', 'pipe'] });
	const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
	let stderr = '';
	child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
		stderr = (stderr + chunk).slice(-4000);
	});
	const stop = async () => {
		if (child.exitCode !== null || child.signalCode !== null) return;
		child.kill('SIGTERM');
		const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
		await exited;
		clearTimeout(timer);
	};

	const deadline = Date.now() + (options.startTimeoutMs ?? 15_000);
	try {
		const origin = await new Promise<string>((resolve, reject) => {
			let buffer = '';
			const timer = setTimeout(
				() => reject(new MockBankStartError('mock-bank did not print "listening <url>" in time')),
				Math.max(0, deadline - Date.now()),
			);
			child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
				buffer += chunk;
				for (const line of buffer.split('\n')) {
					const found = parseListeningLine(line);
					if (found !== null) {
						clearTimeout(timer);
						resolve(found);
						return;
					}
				}
			});
			child.once('exit', (code) => {
				clearTimeout(timer);
				reject(new MockBankStartError(`mock-bank exited with code ${String(code)} before listening: ${stderr}`));
			});
		});
		child.stdout.resume();
		await waitForHealth(origin, deadline);
		return {
			origin,
			setFault: (code, fault = {}) => admin(origin, 'POST', '/__admin/faults', { code, ...fault }),
			clearFaults: () => admin(origin, 'DELETE', '/__admin/faults'),
			reset: () => admin(origin, 'POST', '/__admin/reset'),
			stop,
		};
	} catch (error) {
		await stop();
		throw error;
	}
}
