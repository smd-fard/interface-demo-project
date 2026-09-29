import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEPENDENCY_SECTIONS } from './WorkspaceGraph.js';
import type { DependencySection, WorkspaceGraph, WorkspaceNode } from './WorkspaceGraph.js';
import { WorkspaceReadError } from './WorkspaceReadError.js';

/** Same one-level globs as `pnpm-workspace.yaml`: `packages/*`, `apps/*`, `tools/*`. */
const WORKSPACE_PARENTS = ['packages', 'apps', 'tools'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSection(
	manifest: Record<string, unknown>,
	section: DependencySection,
	path: string,
): Record<string, string> {
	const value = manifest[section];
	if (value === undefined) {
		return {};
	}
	if (!isRecord(value)) {
		throw new WorkspaceReadError(path, `"${section}" must be an object of name → version`);
	}
	const out: Record<string, string> = {};
	for (const [dep, version] of Object.entries(value)) {
		if (typeof version !== 'string') {
			throw new WorkspaceReadError(path, `"${section}.${dep}" must be a version string`);
		}
		out[dep] = version;
	}
	return out;
}

function readManifest(dir: string, path: string): WorkspaceNode {
	let text: string;
	try {
		text = readFileSync(path, 'utf8');
	} catch (error) {
		throw new WorkspaceReadError(path, 'unreadable', { cause: error });
	}
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (error) {
		throw new WorkspaceReadError(path, 'invalid JSON', { cause: error });
	}
	if (!isRecord(raw)) {
		throw new WorkspaceReadError(path, 'manifest must be a JSON object');
	}
	const name = raw['name'];
	if (typeof name !== 'string' || name.length === 0) {
		throw new WorkspaceReadError(path, 'missing "name"');
	}
	const sections = Object.fromEntries(
		DEPENDENCY_SECTIONS.map((section) => [section, readSection(raw, section, path)]),
	) as Record<DependencySection, Record<string, string>>;
	return { name, dir, ...sections };
}

/**
 * Reads every workspace manifest under `<root>/{packages,apps,tools}/<x>/package.json`.
 * Directories without a `package.json` are skipped. Order is deterministic (sorted by directory).
 *
 * @throws {@link WorkspaceReadError} (`WORKSPACE_READ_FAILED`) on an unreadable or invalid manifest, or a
 * duplicate workspace name.
 */
export function readWorkspaceGraph(root: string): WorkspaceGraph {
	const graph = new Map<string, WorkspaceNode>();
	for (const parent of WORKSPACE_PARENTS) {
		const parentDir = join(root, parent);
		if (!existsSync(parentDir)) {
			continue;
		}
		let entries;
		try {
			entries = readdirSync(parentDir, { withFileTypes: true });
		} catch (error) {
			throw new WorkspaceReadError(parentDir, 'cannot list directory', { cause: error });
		}
		const dirs = entries
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort();
		for (const entryName of dirs) {
			const dir = join(parentDir, entryName);
			const path = join(dir, 'package.json');
			if (!existsSync(path)) {
				continue;
			}
			const node = readManifest(dir, path);
			const existing = graph.get(node.name);
			if (existing !== undefined) {
				throw new WorkspaceReadError(path, `duplicate workspace name "${node.name}" (also in ${existing.dir})`);
			}
			graph.set(node.name, node);
		}
	}
	return graph;
}
