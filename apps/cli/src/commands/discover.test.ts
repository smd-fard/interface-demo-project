import { createRedactor } from '@idp/policy';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CliContext } from '../cli/CliContext.js';
import { EXIT } from '../cli/exitCodes.js';
import { CliUsageError } from '../errors/CliUsageError.js';
import { Printer } from '../output/Printer.js';
import { run } from './discover.js';

// The agent, the config and the credentials are faked at the module boundary: no browser, no model, no files.
const agent = vi.hoisted(() => ({ outcome: undefined as unknown, runnerOptions: [] as unknown[] }));
vi.mock('@idp/agent', () => ({
	AnthropicModelClient: vi.fn(),
	ScriptedModel: { fromFile: vi.fn(async () => ({ modelId: 'scripted:unit' })) },
	DiscoveryRunner: class {
		constructor(options: unknown) {
			agent.runnerOptions.push(options);
		}
		run() {
			return Promise.resolve({ outcome: agent.outcome, runId: 'discovery-x', runDir: '/runs/discovery-x' });
		}
	},
}));
vi.mock('../config/loadConfig.js', () => ({
	loadConfig: vi.fn(async () => ({
		origin: 'http://127.0.0.1:4010',
		profile: { credentialRef: 'mockbank-operator', variant: 'tenant-a' },
		policy: {},
	})),
}));
vi.mock('../config/EnvCredentialProvider.js', () => ({
	EnvCredentialProvider: class {
		resolve() {
			return Promise.resolve({ username: 'teller01', password: 'synthetic-pass-01' });
		}
	},
}));

function context(): { context: CliContext; out: string[]; err: string[] } {
	const out: string[] = [];
	const err: string[] = [];
	const printer = new Printer(
		{ write: (chunk: string) => out.push(chunk) },
		{ write: (chunk: string) => err.push(chunk) },
		createRedactor({ sensitiveValues: [] }),
	);
	return { context: { printer, env: {}, repoRoot: '/repo', invocationDir: '/repo' }, out, err };
}

const ARGS = ['--goal', 'look up member 12345', '--input', 'memberId=12345', '--model', 'scripted:x.json'];

beforeEach(() => {
	agent.runnerOptions.length = 0;
});

describe('idp discover', () => {
	it('refuses a boolean --output with a usage error before any model or session (FR7)', async () => {
		const { context: ctx } = context();
		await expect(run([...ARGS, '--output', 'isActive:boolean'], ctx)).rejects.toBeInstanceOf(CliUsageError);
		await expect(run([...ARGS, '--output', 'isActive:boolean'], ctx)).rejects.toThrow(/declare it as isActive:string/);
		expect(agent.runnerOptions).toEqual([]);
	});

	it('exits 1 (not 4) when the model API failed after its retries (FR9)', async () => {
		agent.outcome = {
			kind: 'stopped',
			reason: 'model_error',
			detail: 'model call failed (HTTP 529): overloaded (retryable: true)',
			turns: 1,
			retryable: true,
			trace: { steps: [], outputs: [], finish: null },
		};
		const { context: ctx, out, err } = context();
		expect(await run(ARGS, ctx)).toBe(EXIT.failure);
		expect(out.join('')).toContain('discovery stopped: model_error');
		expect(err.join('')).toContain('transient: try again later');
	});

	it('still exits 4 for an ordinary stop', async () => {
		agent.outcome = {
			kind: 'stopped',
			reason: 'dead_end',
			detail: 'no progress',
			turns: 3,
			trace: { steps: [], outputs: [], finish: null },
		};
		expect(await run(ARGS, context().context)).toBe(EXIT.discoveryStopped);
	});

	it('wires the control-file callbacks only when attended (FR4)', async () => {
		agent.outcome = { kind: 'stopped', reason: 'dead_end', detail: 'x', turns: 1, trace: {} };
		await run(ARGS, context().context);
		await run([...ARGS, '--attended'], context().context);
		const [unattended, attended] = agent.runnerOptions as Record<string, unknown>[];
		expect(unattended?.['onSessionOpen']).toBeUndefined();
		expect(attended?.['onSessionOpen']).toBeTypeOf('function');
		expect(attended?.['onSessionClosed']).toBeTypeOf('function');
	});
});
