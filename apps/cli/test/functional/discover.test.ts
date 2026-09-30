import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ControlClient } from '@idp/session';
import { launchMockBank, type MockBank } from '@idp/surface/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// `idp discover` flag handling and the attended control handoff (review-fixes FR4, FR7), against the built CLI and
// a live mock-bank, with a scripted model only (no LLM).

const CLI_DIR = path.resolve(import.meta.dirname, '../..');
const REPO_ROOT = path.resolve(CLI_DIR, '../..');
const MAIN = path.join(CLI_DIR, 'dist', 'main.js');
const SECRETS = ['12345', 'teller01', 'synthetic-pass-01'];

let bank: MockBank;
let root: string;
let runsRoot: string;

interface Child {
	readonly done: Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }>;
	stdout(): string;
}

function start(args: readonly string[]): Child {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		INIT_CWD: REPO_ROOT,
		IDP_NO_DOTENV: '1',
		IDP_RUNS_ROOT: runsRoot,
		IDP_CONTROL_PORT: '0',
		MOCKBANK_ORIGIN: bank.origin,
		MOCKBANK_OPERATOR_USER: 'teller01',
		MOCKBANK_OPERATOR_PASSWORD: 'synthetic-pass-01',
	};
	delete env['ANTHROPIC_API_KEY'];
	const child = spawn(process.execPath, [MAIN, ...args], { cwd: CLI_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
	let stdout = '';
	let stderr = '';
	child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
	child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
	const done = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
		child.once('error', reject);
		child.once('close', (code) => resolve({ code, stdout, stderr }));
	});
	return { done, stdout: () => stdout };
}

/** Polls until `find` returns a value (or fails the test after `timeoutMs`). */
async function waitFor<T>(find: () => Promise<T | null>, timeoutMs: number, what: string): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const found = await find();
		if (found !== null) return found;
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

async function controlJsonUnder(dir: string): Promise<string | null> {
	if (!existsSync(dir)) return null;
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const file = path.join(dir, entry.name, 'control.json');
		if (entry.isDirectory() && existsSync(file)) return file;
	}
	return null;
}

const DISCOVER = [
	'discover',
	'--goal',
	'look up member 12345 and read their current savings balance',
	'--input',
	'memberId=12345',
	'--sensitive',
	'memberId',
] as const;

beforeAll(async () => {
	if (!existsSync(MAIN)) throw new Error(`${MAIN} not found: run \`pnpm --filter @idp/cli build\``);
	bank = await launchMockBank({ tenant: 'a' });
	root = await mkdtemp(path.join(tmpdir(), 'idp-cli-discover-'));
	runsRoot = path.join(root, 'runs');
});

afterAll(async () => {
	await bank?.stop();
	if (root !== undefined) await rm(root, { recursive: true, force: true });
});

describe('idp discover --output', () => {
	it('refuses a boolean output with a usage error (exit 64) before any browser starts', async () => {
		const run = await start([
			...DISCOVER,
			'--model',
			'scripted:packages/agent/scripts/member-lookup.script.json',
			'--output',
			'isActive:boolean',
		]).done;
		expect(run.code).toBe(64);
		expect(run.stderr).toContain('boolean outputs are not supported');
		expect(run.stderr).toContain('isActive:string');
		expect(existsSync(runsRoot) ? await readdir(runsRoot) : []).toEqual([]);
	});
});

describe('idp discover --attended', () => {
	it('writes the control files, prints the control URL and token file (never the token), and an operator can reach the session', async () => {
		const script = path.join(root, 'ask-for-help.script.json');
		await writeFile(
			script,
			JSON.stringify({
				scriptVersion: 1,
				name: 'ask-for-help',
				steps: [
					{
						tool: 'request_help',
						input: { reason: 'The sign-on screen is shown but I need an operator to continue from here.' },
					},
				],
			}),
		);
		const dir = path.join(root, 'attended-runs');
		runsRoot = dir;
		const child = start([...DISCOVER, '--model', `scripted:${script}`, '--attended', '--no-verify-replay']);

		const controlJson = await waitFor(() => controlJsonUnder(dir), 60_000, 'control.json');
		const files = JSON.parse(await readFile(controlJson, 'utf8')) as { controlUrl: string; tokenFile: string };
		expect(files.controlUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		expect(files.tokenFile).toBe(path.join(path.dirname(controlJson), 'control.token'));
		expect((await stat(files.tokenFile)).mode & 0o777).toBe(0o600);
		const token = (await readFile(files.tokenFile, 'utf8')).trim();

		// The session is reachable with the token from the file: wait for the help request, then abort the run.
		const client = new ControlClient({ url: files.controlUrl, token });
		await waitFor(async () => ((await client.interventions()).length > 0 ? true : null), 30_000, 'the help request');
		await client.abort('ops-1');

		const run = await child.done;
		expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(4);
		expect(run.stdout).toContain(`attended session: control API at ${files.controlUrl}`);
		expect(run.stdout).toContain(`control token written to ${files.tokenFile} (mode 0600; it is not printed)`);
		expect(run.stdout).toContain('discovery stopped: human_aborted');
		expect(run.stdout).not.toContain(token);
		expect(run.stderr).not.toContain(token);
		for (const secret of SECRETS) expect(run.stdout + run.stderr).not.toContain(secret);
		// A finished session removes its control files (the token is dead).
		expect(existsSync(controlJson)).toBe(false);
		expect(existsSync(files.tokenFile)).toBe(false);
	}, 120_000);
});
