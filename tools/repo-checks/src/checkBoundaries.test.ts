import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { BoundaryViolation } from './BoundaryViolation.js';
import { checkBoundaries } from './checkBoundaries.js';
import { loadLayerModel } from './LayerModel.js';
import type { DependencySection, WorkspaceGraph, WorkspaceNode } from './WorkspaceGraph.js';

const model = loadLayerModel(fileURLToPath(new URL('../layers.json', import.meta.url)));

type Sections = Partial<Record<DependencySection, Record<string, string>>>;

const WS = 'workspace:*';
const TS_CONFIG = { '@idp/typescript-config': WS };

function deps(...names: string[]): Record<string, string> {
	return Object.fromEntries(names.map((name) => [name, WS]));
}

/** The correct graph (plan step 5). Every workspace has @idp/typescript-config as a devDependency. */
function correctManifests(): Record<string, Sections> {
	const core = ['@idp/artifact-schema', '@idp/policy', '@idp/evidence', '@idp/surface', '@idp/session'];
	return {
		'@idp/typescript-config': {},
		'@idp/repo-checks': { devDependencies: { ...TS_CONFIG } },
		'@idp/artifact-schema': { devDependencies: { ...TS_CONFIG } },
		'@idp/policy': { dependencies: deps('@idp/artifact-schema'), devDependencies: { ...TS_CONFIG } },
		'@idp/evidence': { dependencies: deps('@idp/artifact-schema', '@idp/policy'), devDependencies: { ...TS_CONFIG } },
		'@idp/surface': { dependencies: deps(...core.slice(0, 3)), devDependencies: { ...TS_CONFIG } },
		'@idp/session': { dependencies: deps(...core.slice(0, 4)), devDependencies: { ...TS_CONFIG } },
		'@idp/replay-engine': { dependencies: deps(...core), devDependencies: { ...TS_CONFIG } },
		'@idp/agent': { dependencies: deps(...core), devDependencies: { ...TS_CONFIG } },
		'@idp/cli': {
			dependencies: deps('@idp/artifact-schema', '@idp/session', '@idp/replay-engine', '@idp/agent'),
			devDependencies: { ...TS_CONFIG },
		},
		'@idp/operator': { dependencies: deps('@idp/artifact-schema', '@idp/session'), devDependencies: { ...TS_CONFIG } },
		'@idp/mock-bank': { devDependencies: { ...TS_CONFIG } },
	};
}

function toGraph(manifests: Record<string, Sections>): WorkspaceGraph {
	const graph = new Map<string, WorkspaceNode>();
	for (const [name, sections] of Object.entries(manifests)) {
		graph.set(name, {
			name,
			dir: `/repo/${name.slice('@idp/'.length)}`,
			dependencies: sections.dependencies ?? {},
			devDependencies: sections.devDependencies ?? {},
			peerDependencies: sections.peerDependencies ?? {},
			optionalDependencies: sections.optionalDependencies ?? {},
		});
	}
	return graph;
}

/** Correct graph with `mutate` applied to the named workspace's manifest. */
function withChange(name: string, mutate: (sections: Sections) => void): WorkspaceGraph {
	const manifests = correctManifests();
	const sections = manifests[name] ?? {};
	mutate(sections);
	manifests[name] = sections;
	return toGraph(manifests);
}

function addDep(section: DependencySection, dep: string, version = WS): (sections: Sections) => void {
	return (sections) => {
		sections[section] = { ...(sections[section] ?? {}), [dep]: version };
	};
}

function find(violations: BoundaryViolation[], code: string, pkg: string, dep: string): BoundaryViolation | undefined {
	return violations.find((v) => v.code === code && v.package === pkg && v.dependency === dep);
}

describe('checkBoundaries', () => {
	it('reports nothing for the correct graph', () => {
		expect(checkBoundaries(toGraph(correctManifests()), model)).toEqual([]);
	});

	it('AC4: replay-engine → session → agent is BND006 with the chain, plus BND001 for session → agent', () => {
		const violations = checkBoundaries(withChange('@idp/session', addDep('dependencies', '@idp/agent')), model);
		const reach = find(violations, 'BND006', '@idp/replay-engine', '@idp/agent');
		expect(reach).toBeDefined();
		expect(reach?.rule).toBe('forbidden-reach');
		expect(reach?.path).toEqual(['@idp/replay-engine', '@idp/session', '@idp/agent']);
		expect(reach?.message).toContain('@idp/replay-engine → @idp/session → @idp/agent');
		const direction = find(violations, 'BND001', '@idp/session', '@idp/agent');
		expect(direction?.rule).toBe('layer-direction');
		expect(direction?.section).toBe('dependencies');
	});

	it('AC5a: mock-bank → artifact-schema is BND003', () => {
		const violations = checkBoundaries(
			withChange('@idp/mock-bank', addDep('dependencies', '@idp/artifact-schema')),
			model,
		);
		expect(find(violations, 'BND003', '@idp/mock-bank', '@idp/artifact-schema')?.rule).toBe('mock-bank-isolation');
		expect(violations.every((v) => v.code === 'BND003')).toBe(true);
	});

	it('BND003: any workspace depending on mock-bank', () => {
		const violations = checkBoundaries(withChange('@idp/cli', addDep('devDependencies', '@idp/mock-bank')), model);
		expect(find(violations, 'BND003', '@idp/cli', '@idp/mock-bank')?.section).toBe('devDependencies');
	});

	it('mock-bank with @idp/typescript-config as a devDependency is fine; as a dependency it is not', () => {
		expect(checkBoundaries(toGraph(correctManifests()), model)).toEqual([]);
		const violations = checkBoundaries(
			withChange('@idp/mock-bank', addDep('dependencies', '@idp/typescript-config')),
			model,
		);
		expect(find(violations, 'BND003', '@idp/mock-bank', '@idp/typescript-config')).toBeDefined();
	});

	it('AC5b: policy with playwright as a devDependency is BND004', () => {
		const violations = checkBoundaries(
			withChange('@idp/policy', addDep('devDependencies', 'playwright', '^1.0.0')),
			model,
		);
		const v = find(violations, 'BND004', '@idp/policy', 'playwright');
		expect(v?.rule).toBe('playwright-owner');
		expect(v?.section).toBe('devDependencies');
	});

	it('BND004 covers playwright-core and @playwright/test; surface itself may own them', () => {
		const onCli = checkBoundaries(withChange('@idp/cli', addDep('peerDependencies', '@playwright/test', '^1')), model);
		expect(find(onCli, 'BND004', '@idp/cli', '@playwright/test')).toBeDefined();
		const onSurface = checkBoundaries(
			withChange('@idp/surface', (s) => {
				addDep('dependencies', 'playwright-core', '^1')(s);
				addDep('devDependencies', '@playwright/test', '^1')(s);
			}),
			model,
		);
		expect(onSurface).toEqual([]);
	});

	it('AC5c: surface with @anthropic-ai/sdk is BND005', () => {
		const violations = checkBoundaries(
			withChange('@idp/surface', addDep('dependencies', '@anthropic-ai/sdk', '^0.1.0')),
			model,
		);
		expect(find(violations, 'BND005', '@idp/surface', '@anthropic-ai/sdk')?.rule).toBe('anthropic-owner');
		// replay-engine now reaches the SDK through surface.
		const reach = find(violations, 'BND006', '@idp/replay-engine', '@anthropic-ai/sdk');
		expect(reach?.path).toEqual(['@idp/replay-engine', '@idp/surface', '@anthropic-ai/sdk']);
	});

	it('agent may own @anthropic-ai/sdk', () => {
		expect(
			checkBoundaries(withChange('@idp/agent', addDep('dependencies', '@anthropic-ai/sdk', '^0.1.0')), model),
		).toEqual([]);
	});

	it('AC5d: artifact-schema with runtime lodash is BND007; zod is allowed; dev deps are not restricted', () => {
		const violations = checkBoundaries(
			withChange('@idp/artifact-schema', (s) => {
				addDep('dependencies', 'lodash', '^4')(s);
				addDep('dependencies', 'zod', '^4')(s);
				addDep('devDependencies', 'fast-check', '^3')(s);
			}),
			model,
		);
		expect(violations).toHaveLength(1);
		expect(find(violations, 'BND007', '@idp/artifact-schema', 'lodash')?.rule).toBe('runtime-allowlist');
	});

	it('AC5e: policy → evidence is BND001', () => {
		const violations = checkBoundaries(withChange('@idp/policy', addDep('dependencies', '@idp/evidence')), model);
		expect(find(violations, 'BND001', '@idp/policy', '@idp/evidence')).toBeDefined();
	});

	it('BND001 applies to every section, including devDependencies', () => {
		const violations = checkBoundaries(withChange('@idp/surface', addDep('devDependencies', '@idp/session')), model);
		expect(find(violations, 'BND001', '@idp/surface', '@idp/session')?.section).toBe('devDependencies');
	});

	it('peers: replay-engine → agent directly is BND001 + BND006', () => {
		const violations = checkBoundaries(withChange('@idp/replay-engine', addDep('dependencies', '@idp/agent')), model);
		expect(find(violations, 'BND001', '@idp/replay-engine', '@idp/agent')).toBeDefined();
		expect(find(violations, 'BND006', '@idp/replay-engine', '@idp/agent')?.path).toEqual([
			'@idp/replay-engine',
			'@idp/agent',
		]);
	});

	it('peers: cli → operator is BND001', () => {
		const violations = checkBoundaries(withChange('@idp/cli', addDep('dependencies', '@idp/operator')), model);
		expect(find(violations, 'BND001', '@idp/cli', '@idp/operator')).toBeDefined();
	});

	it('a two-node cycle is BND002 with the full path, reported once', () => {
		const violations = checkBoundaries(
			withChange('@idp/artifact-schema', addDep('dependencies', '@idp/policy')),
			model,
		);
		const cycles = violations.filter((v) => v.code === 'BND002');
		expect(cycles).toHaveLength(1);
		expect(cycles[0]?.rule).toBe('cycle');
		expect(cycles[0]?.path).toEqual(['@idp/artifact-schema', '@idp/policy', '@idp/artifact-schema']);
		expect(cycles[0]?.message).toContain('@idp/artifact-schema → @idp/policy → @idp/artifact-schema');
	});

	it('an unlisted @idp/foo is BND008', () => {
		const manifests = correctManifests();
		manifests['@idp/foo'] = { devDependencies: { ...TS_CONFIG } };
		const violations = checkBoundaries(toGraph(manifests), model);
		expect(violations).toHaveLength(1);
		expect(violations[0]?.code).toBe('BND008');
		expect(violations[0]?.rule).toBe('unknown-workspace');
		expect(violations[0]?.package).toBe('@idp/foo');
	});

	it('a dependency on an unknown @idp name is BND008', () => {
		const violations = checkBoundaries(withChange('@idp/cli', addDep('dependencies', '@idp/ghost')), model);
		expect(find(violations, 'BND008', '@idp/cli', '@idp/ghost')).toBeDefined();
	});

	it('@idp/typescript-config in dependencies is BND009', () => {
		const violations = checkBoundaries(
			withChange('@idp/policy', addDep('dependencies', '@idp/typescript-config')),
			model,
		);
		expect(find(violations, 'BND009', '@idp/policy', '@idp/typescript-config')?.rule).toBe('tooling-misuse');
	});

	it('a tooling package depending on an architecture package is BND009', () => {
		const violations = checkBoundaries(
			withChange('@idp/repo-checks', addDep('devDependencies', '@idp/artifact-schema')),
			model,
		);
		expect(find(violations, 'BND009', '@idp/repo-checks', '@idp/artifact-schema')).toBeDefined();
	});

	it('output is sorted by code then package, and stable', () => {
		const graph = withChange('@idp/policy', (s) => {
			addDep('dependencies', '@idp/evidence')(s);
			addDep('dependencies', '@idp/typescript-config')(s);
			addDep('devDependencies', 'playwright', '^1')(s);
		});
		const first = checkBoundaries(graph, model);
		const second = checkBoundaries(graph, model);
		expect(second).toEqual(first);
		const keys = first.map((v) => `${v.code}|${v.package}`);
		expect(keys).toEqual([...keys].sort());
		expect(first.length).toBeGreaterThan(2);
	});
});
