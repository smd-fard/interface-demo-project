import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checkBoundaries, formatViolations, loadLayerModel, readWorkspaceGraph } from '../../src/index.js';

function findRepoRoot(start: string): string {
	let dir = start;
	while (!existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
		const parent = path.dirname(dir);
		if (parent === dir) {
			throw new Error(`pnpm-workspace.yaml not found above ${start}`);
		}
		dir = parent;
	}
	return dir;
}

const repoRoot = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const model = loadLayerModel(path.join(repoRoot, 'tools/repo-checks/layers.json'));
const graph = readWorkspaceGraph(repoRoot);

describe('repository boundaries (AC3)', () => {
	it('reads exactly 12 workspaces (11 planned + repo-checks)', () => {
		expect([...graph.keys()].sort()).toEqual(
			[
				'@idp/agent',
				'@idp/artifact-schema',
				'@idp/cli',
				'@idp/evidence',
				'@idp/mock-bank',
				'@idp/operator',
				'@idp/policy',
				'@idp/repo-checks',
				'@idp/replay-engine',
				'@idp/session',
				'@idp/surface',
				'@idp/typescript-config',
			].sort(),
		);
	});

	it('has zero boundary violations', () => {
		const violations = checkBoundaries(graph, model);
		expect(violations, formatViolations(violations)).toEqual([]);
	});

	it("every shell's @idp/* dependencies are strictly left of it (computed from layers.json ranks)", () => {
		const rank = new Map<string, number>();
		model.layers.forEach((group, index) => group.forEach((name) => rank.set(name, index)));
		const tooling = new Set(model.tooling);

		for (const [name, node] of graph) {
			const own = rank.get(name);
			if (own === undefined) {
				continue;
			}
			const scoped = [...Object.keys(node.dependencies), ...Object.keys(node.devDependencies)].filter(
				(dep) => dep.startsWith('@idp/') && !tooling.has(dep),
			);
			const allowed = model.layers.slice(0, own).flat();
			for (const dep of scoped) {
				expect(allowed, `${name} depends on ${dep}`).toContain(dep);
			}
		}
	});

	it('keeps @idp/mock-bank free of @idp/* runtime dependencies and undepended-on', () => {
		const mockBank = graph.get('@idp/mock-bank');
		expect(mockBank).toBeDefined();
		expect(Object.keys(mockBank?.dependencies ?? {}).filter((dep) => dep.startsWith('@idp/'))).toEqual([]);
		for (const node of graph.values()) {
			expect(Object.keys({ ...node.dependencies, ...node.devDependencies })).not.toContain('@idp/mock-bank');
		}
	});
});
