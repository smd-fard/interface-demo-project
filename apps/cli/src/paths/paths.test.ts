import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from './findRepoRoot.js';
import { invocationDir } from './invocationDir.js';
import { resolveRunsRoot } from './resolveRunsRoot.js';
import { displayPath } from '../cli/CliContext.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

describe('findRepoRoot', () => {
	it('walks up to the directory holding pnpm-workspace.yaml', () => {
		expect(findRepoRoot(import.meta.url)).toBe(REPO_ROOT);
	});
});

describe('invocationDir', () => {
	it('prefers INIT_CWD (set by pnpm to the directory pnpm was run from), then the cwd', () => {
		expect(invocationDir({ INIT_CWD: '/from/pnpm' }, '/cwd')).toBe('/from/pnpm');
		expect(invocationDir({}, '/cwd')).toBe('/cwd');
		expect(invocationDir({ INIT_CWD: '' }, '/cwd')).toBe('/cwd');
	});
});

describe('resolveRunsRoot', () => {
	const context = { repoRoot: '/repo', invocationDir: '/here' };
	it('uses --runs-root, then IDP_RUNS_ROOT (both from the invocation dir), then <repo>/.runs', () => {
		expect(resolveRunsRoot(context, {}, 'tmp/runs')).toBe('/here/tmp/runs');
		expect(resolveRunsRoot(context, { IDP_RUNS_ROOT: '/abs/runs' }, undefined)).toBe('/abs/runs');
		expect(resolveRunsRoot(context, { IDP_RUNS_ROOT: 'rel' }, undefined)).toBe('/here/rel');
		expect(resolveRunsRoot(context, {}, undefined)).toBe('/repo/.runs');
	});
});

describe('displayPath', () => {
	const context = { repoRoot: '/repo', invocationDir: '/repo' };
	it('prints paths under the invocation dir relative to it, others absolute', () => {
		expect(displayPath(context, '/repo/.runs/replay-1')).toBe('.runs/replay-1');
		expect(displayPath(context, '/repo')).toBe('.');
		expect(displayPath(context, '/tmp/runs/replay-1')).toBe('/tmp/runs/replay-1');
		expect(displayPath(context, '/repository/x')).toBe('/repository/x');
	});
});
