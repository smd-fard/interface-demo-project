import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readWorkspaceGraph } from './readWorkspaceGraph.js';
import { WorkspaceReadError } from './WorkspaceReadError.js';

const validRoot = fileURLToPath(new URL('../test/fixtures/valid-workspace/', import.meta.url));

describe('readWorkspaceGraph', () => {
	it('finds every manifest under packages/*, apps/*, tools/*', () => {
		const graph = readWorkspaceGraph(validRoot);
		expect([...graph.keys()].sort()).toEqual(['@fixture/app-b', '@fixture/lib-a', '@fixture/tool-c']);
		expect(graph.get('@fixture/app-b')?.dir).toBe(join(validRoot, 'apps', 'app-b'));
	});

	it('maps all four dependency sections (missing sections become empty)', () => {
		const graph = readWorkspaceGraph(validRoot);
		const libA = graph.get('@fixture/lib-a');
		expect(libA?.dependencies).toEqual({ zod: '^4.0.0' });
		expect(libA?.devDependencies).toEqual({ '@fixture/tool-c': 'workspace:*' });
		expect(libA?.peerDependencies).toEqual({ 'left-pad': '^1.0.0' });
		expect(libA?.optionalDependencies).toEqual({ fsevents: '^2.0.0' });
		const toolC = graph.get('@fixture/tool-c');
		expect(toolC?.dependencies).toEqual({});
		expect(toolC?.devDependencies).toEqual({});
		expect(toolC?.peerDependencies).toEqual({});
		expect(toolC?.optionalDependencies).toEqual({});
	});

	describe('invalid manifests', () => {
		// Built at test time: a committed invalid package.json would break `prettier --check .`.
		let root: string;

		beforeEach(() => {
			root = mkdtempSync(join(tmpdir(), 'repo-checks-broken-'));
		});

		afterEach(() => {
			rmSync(root, { recursive: true, force: true });
		});

		function manifest(rel: string, content: string): string {
			const dir = join(root, rel);
			mkdirSync(dir, { recursive: true });
			const path = join(dir, 'package.json');
			writeFileSync(path, content);
			return path;
		}

		function expectReadError(path: string): void {
			let caught: unknown;
			try {
				readWorkspaceGraph(root);
			} catch (error) {
				caught = error;
			}
			expect(caught).toBeInstanceOf(WorkspaceReadError);
			const error = caught as WorkspaceReadError;
			expect(error.code).toBe('WORKSPACE_READ_FAILED');
			expect(error.path).toBe(path);
			expect(error.message).toContain(path);
		}

		it('throws WorkspaceReadError naming the path on broken JSON', () => {
			expectReadError(manifest('packages/bad', '{ "name": "@fixture/bad", "dependencies": {'));
		});

		it('throws on a manifest without a name', () => {
			expectReadError(manifest('apps/nameless', '{ "private": true }'));
		});

		it('throws on a dependency section that is not a string map', () => {
			expectReadError(manifest('tools/odd', '{ "name": "@fixture/odd", "dependencies": ["zod"] }'));
		});

		it('throws on two workspaces with the same name', () => {
			manifest('packages/one', '{ "name": "@fixture/dup" }');
			expectReadError(manifest('packages/two', '{ "name": "@fixture/dup" }'));
		});

		it('returns an empty graph when no glob directory exists', () => {
			expect(readWorkspaceGraph(root).size).toBe(0);
		});
	});
});
