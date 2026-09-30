import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readWorkspaceGraph, type WorkspaceGraph } from '@idp/repo-checks/src/index.js';
import { describe, expect, it } from 'vitest';

/**
 * AC5 / R3.1 / invariant 1: the replay path has no LLM. `@idp/replay-engine` must not reach `@idp/agent` or the
 * Anthropic SDK through its runtime dependencies (directly or transitively), and its source must not import
 * either. Reads the real workspace manifests (no network, no build).
 */

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SRC_DIR, '../../..');
const THIS_FILE = fileURLToPath(import.meta.url);
const FORBIDDEN = ['@idp/agent', '@anthropic-ai/sdk'] as const;

/** Runtime sections only: devDependencies never ship with a package. */
const RUNTIME_SECTIONS = ['dependencies', 'peerDependencies', 'optionalDependencies'] as const;

/** Every package (workspace or external) reachable from `start` through runtime dependencies. */
function runtimeClosure(graph: WorkspaceGraph, start: string): Set<string> {
	const reached = new Set<string>();
	const queue = [start];
	for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
		const node = graph.get(name);
		if (node === undefined) continue; // an external package: a leaf here
		for (const section of RUNTIME_SECTIONS) {
			for (const dependency of Object.keys(node[section])) {
				if (reached.has(dependency)) continue;
				reached.add(dependency);
				queue.push(dependency);
			}
		}
	}
	return reached;
}

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(full);
		return entry.isFile() && entry.name.endsWith('.ts') && full !== THIS_FILE ? [full] : [];
	});
}

/** Module specifiers of static imports/exports, dynamic imports and requires. */
function importedModules(source: string): string[] {
	const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
	return [...source.matchAll(pattern)].map((match) => match[1] ?? '');
}

const isForbidden = (specifier: string) =>
	FORBIDDEN.some((name) => specifier === name || specifier.startsWith(`${name}/`));

describe('no-LLM boundary of @idp/replay-engine (AC5, R3.1)', () => {
	const graph = readWorkspaceGraph(REPO_ROOT);

	it('the workspace graph has both ends of the check', () => {
		expect(graph.has('@idp/replay-engine')).toBe(true);
		expect(graph.has('@idp/agent')).toBe(true);
	});

	it('its transitive runtime closure contains neither @idp/agent nor @anthropic-ai/sdk', () => {
		const closure = runtimeClosure(graph, '@idp/replay-engine');
		expect(closure.has('@idp/session')).toBe(true); // the walk is transitive and sees the real layers
		for (const name of FORBIDDEN) expect(closure.has(name), name).toBe(false);
	});

	it('negative control: the closure of @idp/agent does contain @anthropic-ai/sdk (the check can fail)', () => {
		expect(runtimeClosure(graph, '@idp/agent').has('@anthropic-ai/sdk')).toBe(true);
	});

	it('no source file under src/ imports either of them', () => {
		const files = sourceFiles(SRC_DIR);
		expect(files.length).toBeGreaterThan(10);
		const offenders = files.flatMap((file) =>
			importedModules(readFileSync(file, 'utf8'))
				.filter(isForbidden)
				.map((specifier) => `${path.relative(SRC_DIR, file)} → ${specifier}`),
		);
		expect(offenders).toEqual([]);
	});

	it('the import scanner itself recognises every import form (so an empty result means something)', () => {
		const sample = [
			"import { Anthropic } from '@anthropic-ai/sdk';",
			"export * from '@idp/agent';",
			"const m = await import('@idp/agent/tools');",
			"import '@anthropic-ai/sdk/shims';",
		].join('\n');
		expect(importedModules(sample).filter(isForbidden)).toHaveLength(4);
	});
});
