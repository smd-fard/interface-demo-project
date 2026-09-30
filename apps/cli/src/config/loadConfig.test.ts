import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError } from '../errors/ConfigError.js';
import { expandEnvTokens } from './expandEnvTokens.js';
import { loadConfig } from './loadConfig.js';
import { loadDotEnv } from './loadDotEnv.js';
import { mockBankOrigin } from './mockBankOrigin.js';
import { resolveProfilePath } from './resolveProfilePath.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

describe('mockBankOrigin', () => {
	it('prefers MOCKBANK_ORIGIN, then MOCKBANK_PORT, then port 4010', () => {
		expect(mockBankOrigin({ MOCKBANK_ORIGIN: 'http://127.0.0.1:5555' })).toBe('http://127.0.0.1:5555');
		expect(mockBankOrigin({ MOCKBANK_PORT: '4999' })).toBe('http://127.0.0.1:4999');
		expect(mockBankOrigin({})).toBe('http://127.0.0.1:4010');
		// .env.example leaves the keys empty: empty means unset.
		expect(mockBankOrigin({ MOCKBANK_ORIGIN: '', MOCKBANK_PORT: '' })).toBe('http://127.0.0.1:4010');
	});

	it('rejects an origin that is not an http(s) URL', () => {
		expect(() => mockBankOrigin({ MOCKBANK_ORIGIN: 'not a url' })).toThrow(ConfigError);
		expect(() => mockBankOrigin({ MOCKBANK_PORT: 'abc' })).toThrow(ConfigError);
	});
});

describe('expandEnvTokens', () => {
	it('expands ${VAR} in every string of a document, deeply', () => {
		const doc = { a: '${X}', b: ['pre-${X}-post', { c: '${Y}' }], d: 3 };
		expect(expandEnvTokens(doc, { X: 'one', Y: 'two' }, 'test.json')).toEqual({
			a: 'one',
			b: ['pre-one-post', { c: 'two' }],
			d: 3,
		});
	});

	it('fails with unknown_env_var naming the variable and the file, never another value', () => {
		const error = captureError(() => expandEnvTokens({ a: '${NOPE}' }, { SECRET: 'hunter2' }, 'policy.json'));
		expect(error).toBeInstanceOf(ConfigError);
		expect(error).toMatchObject({ code: 'unknown_env_var' });
		expect((error as Error).message).toContain('NOPE');
		expect((error as Error).message).toContain('policy.json');
		expect((error as Error).message).not.toContain('hunter2');
	});

	it('treats an empty variable as unset', () => {
		expect(() => expandEnvTokens({ a: '${X}' }, { X: '' }, 'f')).toThrow(ConfigError);
	});
});

describe('resolveProfilePath', () => {
	it('maps a profile name to config/apps/<name>.profile.json under the repo root', () => {
		expect(resolveProfilePath('mock-bank', { repoRoot: '/repo', invocationDir: '/here' })).toBe(
			'/repo/config/apps/mock-bank.profile.json',
		);
		expect(resolveProfilePath('mock-bank.tenant-b', { repoRoot: '/repo', invocationDir: '/here' })).toBe(
			'/repo/config/apps/mock-bank.tenant-b.profile.json',
		);
	});

	it('treats a value with a slash or a .json suffix as a path from the invocation dir', () => {
		expect(resolveProfilePath('x/p.json', { repoRoot: '/repo', invocationDir: '/here' })).toBe('/here/x/p.json');
		expect(resolveProfilePath('/abs/p.json', { repoRoot: '/repo', invocationDir: '/here' })).toBe('/abs/p.json');
	});
});

describe('loadConfig (the real config/ files)', () => {
	const env = { MOCKBANK_ORIGIN: 'http://127.0.0.1:4555' };

	it('loads config/policy.json with the origin expanded and resolves it', async () => {
		const config = await loadConfig({ repoRoot: REPO_ROOT, invocationDir: REPO_ROOT, env });
		expect(config.origin).toBe('http://127.0.0.1:4555');
		expect([...config.policy.origins]).toEqual(['http://127.0.0.1:4555']);
		expect(config.profile.origin).toBe('http://127.0.0.1:4555');
		expect(config.profile.credentialRef).toBe('mockbank-operator');
		expect(config.profile.variant).toBe('tenant-a');
		expect(config.policyPath).toBe(path.join(REPO_ROOT, 'config', 'policy.json'));
	});

	it('loads the tenant-B profile by name', async () => {
		const config = await loadConfig({
			repoRoot: REPO_ROOT,
			invocationDir: REPO_ROOT,
			env,
			profile: 'mock-bank.tenant-b',
		});
		expect(config.profile.variant).toBe('tenant-b');
	});

	it('fails with config_not_found for an unknown profile', async () => {
		await expect(
			loadConfig({ repoRoot: REPO_ROOT, invocationDir: REPO_ROOT, env, profile: 'no-such-app' }),
		).rejects.toMatchObject({ code: 'config_not_found' });
	});
});

describe('loadConfig (fixture files)', () => {
	let root: string;
	beforeEach(async () => {
		root = await mkdtemp(path.join(tmpdir(), 'idp-cli-config-'));
		await mkdir(path.join(root, 'config', 'apps'), { recursive: true });
	});
	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it('fails with unknown_env_var when the policy names an unset variable', async () => {
		await writeFile(
			path.join(root, 'config', 'policy.json'),
			JSON.stringify({ version: '1.0.0', allow: { origins: ['${UNSET_ORIGIN}'] } }),
		);
		await expect(loadConfig({ repoRoot: root, invocationDir: root, env: {} })).rejects.toMatchObject({
			code: 'unknown_env_var',
		});
	});

	it('fails with config_invalid (issue paths only) for a malformed policy', async () => {
		await writeFile(path.join(root, 'config', 'policy.json'), JSON.stringify({ version: 'secret-value-xyz' }));
		const error = await loadConfig({ repoRoot: root, invocationDir: root, env: {} }).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ConfigError);
		expect(error).toMatchObject({ code: 'config_invalid' });
		expect((error as Error).message).not.toContain('secret-value-xyz');
	});

	it('fails with config_invalid for a file that is not JSON', async () => {
		await writeFile(path.join(root, 'config', 'policy.json'), '{ nope');
		await expect(loadConfig({ repoRoot: root, invocationDir: root, env: {} })).rejects.toMatchObject({
			code: 'config_invalid',
		});
	});
});

describe('loadDotEnv', () => {
	let root: string;
	beforeEach(async () => {
		root = await mkdtemp(path.join(tmpdir(), 'idp-cli-dotenv-'));
	});
	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it('loads <root>/.env into the env without overriding a set variable', async () => {
		await writeFile(path.join(root, '.env'), 'IDP_TEST_A=from-file\nIDP_TEST_B=from-file\n');
		const env: Record<string, string | undefined> = { IDP_TEST_B: 'from-shell' };
		expect(loadDotEnv(root, env)).toBe(true);
		expect(env['IDP_TEST_A']).toBe('from-file');
		expect(env['IDP_TEST_B']).toBe('from-shell');
	});

	it('does nothing when there is no .env, or when IDP_NO_DOTENV=1', async () => {
		expect(loadDotEnv(root, {})).toBe(false);
		await writeFile(path.join(root, '.env'), 'IDP_TEST_A=from-file\n');
		const env: Record<string, string | undefined> = { IDP_NO_DOTENV: '1' };
		expect(loadDotEnv(root, env)).toBe(false);
		expect(env['IDP_TEST_A']).toBeUndefined();
	});
});

function captureError(fn: () => unknown): unknown {
	try {
		fn();
	} catch (error) {
		return error;
	}
	throw new Error('expected an error');
}
