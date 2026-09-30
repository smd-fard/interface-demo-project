import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CapabilityArtifactSchema, computeContentHash, RunResultSchema, type RunResult } from '@idp/artifact-schema';
import { launchMockBank, type MockBank } from '@idp/surface/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI_DIR = path.resolve(import.meta.dirname, '../..');
const REPO_ROOT = path.resolve(CLI_DIR, '../..');
const MAIN = path.join(CLI_DIR, 'dist', 'main.js');

/** Synthetic seed values (apps/mock-bank): none may appear on the CLI's stdout or stderr. */
const SECRETS = ['12345', '99999', 'Jane Sample', '1523.47', 'teller01', 'synthetic-pass-01'];

/**
 * Records every module resolution of `@idp/agent` or the Anthropic SDK on stderr, so a test can prove a command
 * never loads the agent at run time (invariant 1).
 */
const AGENT_PROBE = `data:text/javascript,${encodeURIComponent(`
import { registerHooks } from 'node:module';
registerHooks({
	resolve(specifier, context, next) {
		const result = next(specifier, context);
		if (specifier === '@idp/agent' || specifier.startsWith('@anthropic-ai/') || result.url.includes('/packages/agent/')) {
			process.stderr.write('AGENT_LOADED\\n');
		}
		return result;
	},
});
`)}`;

interface CliRun {
	readonly code: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

let bank: MockBank;
let root: string;
let runsRoot: string;

function cliEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		// pnpm runs `pnpm idp` from the workspace root with cwd apps/cli; mimic it.
		INIT_CWD: REPO_ROOT,
		IDP_NO_DOTENV: '1',
		IDP_RUNS_ROOT: runsRoot,
		MOCKBANK_ORIGIN: bank.origin,
		MOCKBANK_OPERATOR_USER: 'teller01',
		MOCKBANK_OPERATOR_PASSWORD: 'synthetic-pass-01',
		...extra,
	};
	delete env['ANTHROPIC_API_KEY'];
	// An `undefined` in `extra` unsets that variable for the child.
	return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined));
}

function cli(args: readonly string[], options: { env?: NodeJS.ProcessEnv; probe?: boolean } = {}): Promise<CliRun> {
	const nodeArgs = [...(options.probe === true ? ['--import', AGENT_PROBE] : []), MAIN, ...args];
	const child = spawn(process.execPath, nodeArgs, {
		cwd: CLI_DIR,
		env: options.env ?? cliEnv(),
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let stdout = '';
	let stderr = '';
	child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
	child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
	return new Promise((resolve, reject) => {
		child.once('error', reject);
		child.once('close', (code) => resolve({ code, stdout, stderr }));
	});
}

/** The RunResult JSON printed first on stdout by `replay`. */
function resultOf(run: CliRun): RunResult {
	const end = run.stdout.indexOf('\n}\n');
	if (end < 0) throw new Error(`no result JSON on stdout:\n${run.stdout}\n${run.stderr}`);
	return RunResultSchema.parse(JSON.parse(run.stdout.slice(0, end + 2)));
}

function expectNoSecrets(run: CliRun): void {
	for (const secret of SECRETS) {
		expect(run.stdout, `stdout leaks ${secret}`).not.toContain(secret);
		expect(run.stderr, `stderr leaks ${secret}`).not.toContain(secret);
	}
}

beforeAll(async () => {
	if (!existsSync(MAIN)) throw new Error(`${MAIN} not found: run \`pnpm --filter @idp/cli build\``);
	bank = await launchMockBank({ tenant: 'a' });
	root = await mkdtemp(path.join(tmpdir(), 'idp-cli-functional-'));
	runsRoot = path.join(root, 'runs');
});

afterAll(async () => {
	await bank?.stop();
	if (root !== undefined) await rm(root, { recursive: true, force: true });
});

/**
 * The stable reference artifact (hand-written, hash-verified): v1.0.1, `memberId` typed `^\d{5}$`, outputs
 * `savingsBalance` + `memberName`. Contract-specific replay assertions run against it, never against
 * `artifacts/`, whose contents a real discovery run legitimately replaces (see "the shipped catalog" below).
 */
const REFERENCE_ARTIFACT = 'packages/artifact-schema/fixtures/member-lookup.artifact.json';
const CATALOG_DIR = path.join(REPO_ROOT, 'artifacts');
const CATALOG_MEMBER_LOOKUP = 'artifacts/member-lookup.json';

/** The kinds in a replay's run.jsonl (the evidence log). */
async function logKindsOf(runId: string): Promise<string[]> {
	const text = await readFile(path.join(runsRoot, runId, 'run.jsonl'), 'utf8');
	return text
		.split('\n')
		.filter((line) => line.trim() !== '')
		.map((line) => (JSON.parse(line) as { kind: string }).kind);
}

describe('idp replay (the built CLI against a live mock-bank, reference artifact)', () => {
	it('replays the reference member-lookup for 12345: success, exit 0, redacted JSON + summary, no agent loaded', async () => {
		const run = await cli(['replay', '--artifact', REFERENCE_ARTIFACT, '--param', 'memberId=12345'], {
			probe: true,
		});
		expect(run.code, run.stderr).toBe(0);
		const result = resultOf(run);
		expect(result.kind).toBe('success');
		if (result.kind !== 'success') return;
		expect(result.artifact.id).toBe('member-lookup');
		expect(result.outputs).toEqual({ savingsBalance: '[REDACTED]', memberName: '[REDACTED]' });
		expect(run.stdout).toMatch(/^success: member-lookup@1\.0\.1 in \d+\.\d s/m);
		expect(run.stdout).toContain(`run dir: ${path.join(runsRoot, result.runId)}`);
		expect(run.stderr).not.toContain('AGENT_LOADED');
		expectNoSecrets(run);
		const written = await readFile(path.join(runsRoot, result.runId, 'result.json'), 'utf8');
		expect(RunResultSchema.parse(JSON.parse(written))).toEqual(result);
	});

	it('an unknown member (99999) is a business outcome: exit 3, member_not_found', async () => {
		const run = await cli(['replay', '--artifact', REFERENCE_ARTIFACT, '--param', 'memberId=99999']);
		expect(run.code, run.stderr).toBe(3);
		expect(resultOf(run)).toMatchObject({ kind: 'business_outcome', code: 'member_not_found' });
		expect(run.stdout).toMatch(/^business outcome: member_not_found at /m);
		expectNoSecrets(run);
	});

	it('memberId=abc fails with invalid_params: exit 1, before any browser action', async () => {
		const run = await cli(['replay', '--artifact', REFERENCE_ARTIFACT, '--param', 'memberId=abc']);
		expect(run.code, run.stderr).toBe(1);
		const result = resultOf(run);
		expect(result).toMatchObject({ kind: 'failure', reason: 'invalid_params', step: null });
		const kinds = await logKindsOf(result.runId);
		expect(kinds).toContain('run_started');
		expect(kinds).not.toContain('action');
		expect(kinds).not.toContain('policy_verdict');
		expect(kinds).not.toContain('locator_resolved');
		expectNoSecrets(run);
	});

	it('fails fast (exit 1, no run dir) when the operator credential is not configured, naming the env keys only', async () => {
		const before = existsSync(runsRoot) ? await readdir(runsRoot) : [];
		const run = await cli(['replay', '--artifact', REFERENCE_ARTIFACT, '--param', 'memberId=12345'], {
			env: cliEnv({ MOCKBANK_OPERATOR_PASSWORD: undefined }),
		});
		expect(run.code).toBe(1);
		expect(run.stderr).toContain('MOCKBANK_OPERATOR_PASSWORD');
		expect(existsSync(runsRoot) ? await readdir(runsRoot) : []).toEqual(before);
		expectNoSecrets(run);
	});

	it('a usage error exits 64', async () => {
		const run = await cli(['replay', '--artifact', REFERENCE_ARTIFACT, '--bogus']);
		expect(run.code).toBe(64);
		expect(run.stderr).toContain('--bogus');
	});
});

describe('the agent-load probe (positive control)', () => {
	it('sees `idp discover --help` load @idp/agent, so its silence on replay/catalog means something', async () => {
		const run = await cli(['discover', '--help'], { probe: true });
		expect(run.code).toBe(0);
		expect(run.stderr).toContain('AGENT_LOADED');
		expect(run.stdout).toContain('--[no-]verify-replay');
	});
});

describe('idp replay --help', () => {
	it('shows the example params as placeholders, so the redacting printer has nothing to mask', async () => {
		const run = await cli(['replay', '--help']);
		expect(run.code).toBe(0);
		expect(run.stdout).toContain('--param initialDeposit=<amount>');
		expect(run.stdout).not.toMatch(/=\[REDACTED\]/);
	});
});

describe('idp catalog', () => {
	it('--verify exits 0 and lists both artifacts as verified, without loading the agent', async () => {
		const run = await cli(['catalog', '--verify'], { probe: true });
		expect(run.code, run.stderr).toBe(0);
		expect(run.stdout).toMatch(/^member-lookup@\S+ {2}\[verified\]/m);
		expect(run.stdout).toMatch(/^open-sub-account@\S+ {2}\[verified\]/m);
		expect(run.stderr).not.toContain('AGENT_LOADED');
	});

	it('--json prints the catalog as JSON', async () => {
		const run = await cli(['catalog', '--json']);
		expect(run.code).toBe(0);
		const parsed = JSON.parse(run.stdout) as { artifacts: { id: string; status: string }[] };
		expect(parsed.artifacts.map((entry) => [entry.id, entry.status])).toEqual([
			['member-lookup', 'verified'],
			['open-sub-account', 'verified'],
		]);
	});
});

/**
 * Contract-agnostic checks of the shipped catalog. `artifacts/` holds whatever the last accepted discovery
 * compiled (hand-written or from a real model run), so these tests derive the expectations from the artifact
 * files themselves instead of hard-coding a version, param typing or output list.
 */
describe('the shipped catalog (artifacts/, contract-agnostic)', () => {
	it('catalog --verify lists every artifact in artifacts/ as verified (exit 0)', async () => {
		const files = (await readdir(CATALOG_DIR)).filter((file) => file.endsWith('.json'));
		expect(files.length).toBeGreaterThan(0);
		const run = await cli(['catalog', '--verify']);
		expect(run.code, run.stderr).toBe(0);
		for (const file of files) {
			const artifact = CapabilityArtifactSchema.parse(JSON.parse(await readFile(path.join(CATALOG_DIR, file), 'utf8')));
			expect(artifact.contentHash, file).toBe(await computeContentHash(artifact));
			expect(run.stdout, file).toContain(`${artifact.id}@${artifact.version}  [verified]`);
		}
	});

	it('artifacts/member-lookup.json replays seed member 12345: success (exit 0) with every declared output', async () => {
		const artifact = CapabilityArtifactSchema.parse(
			JSON.parse(await readFile(path.join(REPO_ROOT, CATALOG_MEMBER_LOOKUP), 'utf8')),
		);
		const run = await cli(['replay', '--artifact', CATALOG_MEMBER_LOOKUP, '--param', 'memberId=12345'], {
			probe: true,
		});
		expect(run.code, run.stderr).toBe(0);
		const result = resultOf(run);
		expect(result.kind).toBe('success');
		if (result.kind !== 'success') return;
		expect(result.artifact.id).toBe(artifact.id);
		expect(Object.keys(result.outputs).sort()).toEqual(artifact.outputs.map((output) => output.name).sort());
		expect(run.stdout).toContain(`success: ${artifact.id}@${artifact.version} in `);
		expect(run.stderr).not.toContain('AGENT_LOADED');
		expectNoSecrets(run);
	});

	it('artifacts/member-lookup.json replays an unknown member (99999): business outcome member_not_found (exit 3)', async () => {
		const run = await cli(['replay', '--artifact', CATALOG_MEMBER_LOOKUP, '--param', 'memberId=99999']);
		expect(run.code, run.stderr).toBe(3);
		expect(resultOf(run)).toMatchObject({ kind: 'business_outcome', code: 'member_not_found' });
		expectNoSecrets(run);
	});

	/*
	 * Whether `abc` is rejected by the artifact or by the app depends on how the artifact was discovered: a
	 * param typed with a pattern (the reference fixture) fails fast with invalid_params before any browser
	 * action (exit 1); a plain-string param (what a model run may compile) reaches the app, which rejects it
	 * as the business outcome validation_rejected (exit 3). Either way it must never be a success.
	 */
	it('artifacts/member-lookup.json never succeeds for memberId=abc: invalid_params (exit 1) or validation_rejected (exit 3)', async () => {
		const run = await cli(['replay', '--artifact', CATALOG_MEMBER_LOOKUP, '--param', 'memberId=abc']);
		const result = resultOf(run);
		expect(result.kind).not.toBe('success');
		if (result.kind === 'failure') {
			expect(run.code, run.stderr).toBe(1);
			expect(result.reason).toBe('invalid_params');
		} else {
			expect(run.code, run.stderr).toBe(3);
			expect(result).toMatchObject({ kind: 'business_outcome', code: 'validation_rejected' });
		}
		expectNoSecrets(run);
	});
});

describe('idp discover → artifact → idp replay (scripted model, no LLM)', () => {
	let out: string;
	let discover: CliRun;

	beforeAll(async () => {
		out = path.join(root, 'discovered', 'member-lookup.json');
		discover = await cli([
			'discover',
			'--model',
			'scripted:packages/agent/scripts/member-lookup.script.json',
			'--goal',
			'look up member 12345 and read their current savings balance',
			'--input',
			'memberId=12345',
			'--sensitive',
			'memberId',
			'--output',
			'savingsBalance:decimal:2',
			'--output',
			'memberName:string',
			'--id',
			'member-lookup',
			'--out',
			out,
		]);
	}, 120_000);

	it('meets the goal, verifies by replay and saves a valid, hash-verified artifact (exit 0)', async () => {
		expect(discover.code, `${discover.stdout}\n${discover.stderr}`).toBe(0);
		expect(discover.stdout).toContain('discovery goal met');
		expect(discover.stdout).toMatch(/^verify-replay success: member-lookup@1\.0\.0/m);
		expect(discover.stdout).toContain(`artifact saved: ${out}`);
		expectNoSecrets(discover);
		const text = await readFile(out, 'utf8');
		for (const secret of SECRETS) expect(text, `artifact holds ${secret}`).not.toContain(secret);
		const artifact = CapabilityArtifactSchema.parse(JSON.parse(text));
		expect(artifact.id).toBe('member-lookup');
		expect(artifact.contentHash).toBe(await computeContentHash(artifact));
		expect(artifact.params).toEqual([
			expect.objectContaining({ name: 'memberId', sensitive: true, type: { kind: 'string' } }),
		]);
		expect(artifact.outputs.map((output) => [output.name, output.type])).toEqual([
			['savingsBalance', { kind: 'decimal', scale: 2 }],
			['memberName', { kind: 'string' }],
		]);
	});

	it('the discovered artifact replays 12345 → success (exit 0)', async () => {
		const run = await cli(['replay', '--artifact', out, '--param', 'memberId=12345']);
		expect(run.code, run.stderr).toBe(0);
		expect(resultOf(run)).toMatchObject({ kind: 'success', artifact: { id: 'member-lookup' } });
		expectNoSecrets(run);
	});

	it('the discovered artifact replays 99999 → business outcome member_not_found (exit 3)', async () => {
		const run = await cli(['replay', '--artifact', out, '--param', 'memberId=99999']);
		expect(run.code, run.stderr).toBe(3);
		expect(resultOf(run)).toMatchObject({ kind: 'business_outcome', code: 'member_not_found' });
		expectNoSecrets(run);
	});
});

describe('idp discover --model anthropic without a key', () => {
	it('fails fast with the clear message and exit 1, without launching a browser (no run dir)', async () => {
		const before = existsSync(runsRoot) ? await readdir(runsRoot) : [];
		const run = await cli([
			'discover',
			'--model',
			'anthropic',
			'--goal',
			'look up member 12345 and read their current savings balance',
			'--input',
			'memberId=12345',
			'--sensitive',
			'memberId',
		]);
		expect(run.code).toBe(1);
		expect(run.stderr).toContain('error [MISSING_API_KEY]: ANTHROPIC_API_KEY is not set');
		expect(existsSync(runsRoot) ? await readdir(runsRoot) : []).toEqual(before);
		expectNoSecrets(run);
	});
});
