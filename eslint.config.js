// Root ESLint flat config. Lint runs once for the whole repo (`pnpm lint`).
//
// The boundary block below is generated from tools/repo-checks/layers.json, the same file the manifest
// checker (`pnpm boundaries`) reads, so the source-level and manifest-level checks cannot drift.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import layers from './tools/repo-checks/layers.json' with { type: 'json' };

const root = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_GROUPS = ['packages', 'apps', 'tools'];

/** Every workspace (same globs as pnpm-workspace.yaml) as { name, dir } with a repo-relative dir. */
function listWorkspaces() {
	const workspaces = [];
	for (const group of WORKSPACE_GROUPS) {
		const groupDir = path.join(root, group);
		if (!existsSync(groupDir)) continue;
		for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
			const manifest = path.join(groupDir, entry.name, 'package.json');
			if (!entry.isDirectory() || !existsSync(manifest)) continue;
			const { name } = JSON.parse(readFileSync(manifest, 'utf8'));
			workspaces.push({ name, dir: `${group}/${entry.name}` });
		}
	}
	return workspaces;
}

const rankOf = new Map(layers.layers.flatMap((group, rank) => group.map((name) => [name, rank])));
const architecture = [...rankOf.keys()];

function forbid(specifier, message) {
	return { group: [specifier, `${specifier}/*`], message };
}

/** The merged `no-restricted-imports` patterns for one workspace. */
function boundaryPatterns(name) {
	const patterns = [];
	const rank = rankOf.get(name);
	if (rank !== undefined) {
		for (const other of architecture) {
			if (other !== name && (rankOf.get(other) ?? -1) >= rank) {
				patterns.push(forbid(other, `BND001 layer-direction: ${name} may import only packages to its left.`));
			}
		}
	} else if (layers.isolated.includes(name)) {
		patterns.push({ group: ['@idp/*'], message: `BND003 mock-bank-isolation: ${name} imports nothing from @idp/*.` });
	} else if (layers.tooling.includes(name)) {
		for (const other of architecture) {
			patterns.push(forbid(other, `BND009 tooling-misuse: ${name} must not import architecture packages.`));
		}
	}
	if (!layers.isolated.includes(name)) {
		for (const isolated of layers.isolated) {
			patterns.push(forbid(isolated, `BND003 mock-bank-isolation: nothing imports ${isolated}.`));
		}
	}
	for (const [dependency, owner] of Object.entries(layers.owners)) {
		if (owner === name) continue;
		const code = owner === '@idp/surface' ? 'BND004 playwright-owner' : 'BND005 anthropic-owner';
		patterns.push(forbid(dependency, `${code}: only ${owner} may import ${dependency}.`));
	}
	return patterns;
}

/** Relative imports must stay inside their own workspace; cross-workspace code goes through package names. */
const noRelativeCrossWorkspace = {
	meta: {
		type: 'problem',
		schema: [],
		messages: {
			escapes: "Boundary: relative import '{{source}}' leaves workspace {{workspace}}. Import the package by name.",
		},
	},
	create(context) {
		const file = path.relative(root, context.filename).split(path.sep).join('/');
		const match = /^(packages|apps|tools)\/[^/]+/.exec(file);
		if (!match) return {};
		const workspaceDir = path.join(root, match[0]);
		const check = (node) => {
			const source = node?.value;
			if (typeof source !== 'string' || !source.startsWith('.')) return;
			const target = path.resolve(path.dirname(context.filename), source);
			if (target !== workspaceDir && !target.startsWith(workspaceDir + path.sep)) {
				context.report({ node, messageId: 'escapes', data: { source, workspace: match[0] } });
			}
		};
		return {
			ImportDeclaration: (node) => check(node.source),
			ExportNamedDeclaration: (node) => check(node.source),
			ExportAllDeclaration: (node) => check(node.source),
			ImportExpression: (node) => check(node.source),
		};
	},
};

const boundaries = listWorkspaces().map(({ name, dir }) => ({
	name: `idp/boundaries/${name}`,
	files: [`${dir}/**/*.ts`],
	// Exactly one object per workspace: a later object matching the same files would replace these options.
	rules: { 'no-restricted-imports': ['error', { patterns: boundaryPatterns(name) }] },
}));

// Invariant 1 (no LLM on the replay path): the CLI's replay and catalog code never reaches the agent. This object
// matches files the cli boundary object also matches, so it repeats the cli patterns and adds the agent ban.
const replayPathNoAgent = {
	name: 'idp/cli-replay-path-no-agent',
	files: [
		'apps/cli/src/commands/replay.ts',
		'apps/cli/src/commands/catalog.ts',
		'apps/cli/src/replay/**/*.ts',
		'apps/cli/src/catalog/**/*.ts',
	],
	rules: {
		'no-restricted-imports': [
			'error',
			{
				patterns: [
					...boundaryPatterns('@idp/cli'),
					forbid('@idp/agent', 'Invariant 1: the replay/catalog path never constructs or calls the agent (R3.1).'),
				],
			},
		],
	},
};

export default defineConfig(
	{ ignores: ['**/dist/**', '**/.turbo/**', '**/coverage/**', '**/node_modules/**', 'evidence/**', '.claude/**'] },
	js.configs.recommended,
	tseslint.configs.strict,
	tseslint.configs.stylistic,
	{
		name: 'idp/project',
		languageOptions: { globals: globals.node },
		plugins: { idp: { rules: { 'no-relative-cross-workspace': noRelativeCrossWorkspace } } },
		rules: {
			'@typescript-eslint/consistent-type-imports': 'error',
			'no-console': 'error',
			'idp/no-relative-cross-workspace': 'error',
		},
	},
	{ name: 'idp/cli-console', files: ['tools/repo-checks/src/cli.ts'], rules: { 'no-console': 'off' } },
	boundaries,
	replayPathNoAgent,
	prettier,
);
