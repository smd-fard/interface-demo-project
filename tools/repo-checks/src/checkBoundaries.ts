import { BOUNDARY_RULES } from './BoundaryViolation.js';
import type { BoundaryCode, BoundaryViolation } from './BoundaryViolation.js';
import type { LayerModel } from './LayerModel.js';
import { DEPENDENCY_SECTIONS } from './WorkspaceGraph.js';
import type { DependencySection, WorkspaceGraph, WorkspaceNode } from './WorkspaceGraph.js';

const SCOPE = '@idp/';
const ARROW = ' → ';

interface Edge {
	readonly to: string;
	readonly section: DependencySection;
}

function violation(
	code: BoundaryCode,
	pkg: string,
	dependency: string,
	section: DependencySection | null,
	message: string,
	path: readonly string[] = [pkg, dependency],
): BoundaryViolation {
	return { code, rule: BOUNDARY_RULES[code], package: pkg, dependency, section, path, message };
}

/** Every declared dependency of a node, in section order then name order (deterministic). */
function edgesOf(node: WorkspaceNode): Edge[] {
	const edges: Edge[] = [];
	for (const section of DEPENDENCY_SECTIONS) {
		for (const to of Object.keys(node[section]).sort()) {
			edges.push({ to, section });
		}
	}
	return edges;
}

/** `@idp/*` edges, first section wins per target (dependencies before devDependencies, …). */
function scopedEdges(node: WorkspaceNode, exclude: ReadonlySet<string>): Edge[] {
	const byTarget = new Map<string, Edge>();
	for (const edge of edgesOf(node)) {
		if (edge.to.startsWith(SCOPE) && !exclude.has(edge.to) && !byTarget.has(edge.to)) {
			byTarget.set(edge.to, edge);
		}
	}
	return [...byTarget.values()].sort((a, b) => compare(a.to, b.to));
}

function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/** The owner rule code for a third-party package listed in `owners`. */
function ownerCode(dependency: string): BoundaryCode {
	// The Anthropic SDK has its own rule; every other owned package (playwright family) is BND004.
	return dependency.startsWith('@anthropic-ai/') ? 'BND005' : 'BND004';
}

/** BND001, BND003, BND004/5, BND007, BND008, BND009: per-edge manifest rules. */
function checkEdges(graph: WorkspaceGraph, model: LayerModel, out: BoundaryViolation[]): void {
	const rank = new Map<string, number>();
	model.layers.forEach((group, index) => group.forEach((name) => rank.set(name, index)));
	const isolated = new Set(model.isolated);
	const tooling = new Set(model.tooling);
	const isKnown = (name: string): boolean => rank.has(name) || isolated.has(name) || tooling.has(name);

	for (const node of graph.values()) {
		const name = node.name;
		const nodeKnown = isKnown(name);
		if (!nodeKnown) {
			out.push(
				violation('BND008', name, name, null, 'workspace is not listed in layers.json (layers, isolated or tooling)', [
					name,
				]),
			);
		}
		const allowlist = model.runtimeAllowlist[name];

		for (const { to, section } of edgesOf(node)) {
			const owner = model.owners[to];
			if (owner !== undefined && owner !== name) {
				out.push(violation(ownerCode(to), name, to, section, `only ${owner} may depend on ${to} (any section)`));
			}
			if (allowlist !== undefined && section === 'dependencies' && !allowlist.includes(to)) {
				out.push(
					violation('BND007', name, to, section, `runtime dependencies are limited to [${allowlist.join(', ')}]`),
				);
			}
			if (!to.startsWith(SCOPE)) {
				continue;
			}

			if (isolated.has(name)) {
				if (!(tooling.has(to) && section === 'devDependencies')) {
					out.push(
						violation('BND003', name, to, section, `${name} is isolated: only tooling devDependencies are allowed`),
					);
				}
			} else if (isolated.has(to)) {
				out.push(violation('BND003', name, to, section, `${to} is isolated: no workspace may depend on it`));
			} else if (tooling.has(to)) {
				if (section !== 'devDependencies') {
					out.push(violation('BND009', name, to, section, `tooling package ${to} must be a devDependency`));
				}
			} else if (tooling.has(name)) {
				out.push(
					violation('BND009', name, to, section, `tooling package ${name} must not depend on architecture packages`),
				);
			} else if (!isKnown(to)) {
				out.push(violation('BND008', name, to, section, `${to} is not listed in layers.json`));
			} else if (nodeKnown) {
				const from = rank.get(name);
				const target = rank.get(to);
				if (from !== undefined && target !== undefined && target >= from) {
					out.push(
						violation(
							'BND001',
							name,
							to,
							section,
							`${to} (rank ${target}) is not strictly left of ${name} (rank ${from})`,
						),
					);
				}
			}
		}
	}
}

/** BND002: one finding per strongly connected component, as a canonical cycle starting at its smallest name. */
function checkCycles(graph: WorkspaceGraph, model: LayerModel, out: BoundaryViolation[]): void {
	const tooling = new Set(model.tooling);
	const adjacency = new Map<string, Edge[]>();
	for (const node of [...graph.values()].sort((a, b) => compare(a.name, b.name))) {
		adjacency.set(node.name, tooling.has(node.name) ? [] : scopedEdges(node, tooling));
	}

	// Tarjan's SCC (recursive; the graph is a dozen workspaces).
	let counter = 0;
	const index = new Map<string, number>();
	const low = new Map<string, number>();
	const stack: string[] = [];
	const onStack = new Set<string>();
	const components: string[][] = [];
	const visit = (v: string): void => {
		index.set(v, counter);
		low.set(v, counter);
		counter += 1;
		stack.push(v);
		onStack.add(v);
		for (const { to } of adjacency.get(v) ?? []) {
			if (!adjacency.has(to)) {
				continue;
			}
			if (!index.has(to)) {
				visit(to);
				low.set(v, Math.min(low.get(v) ?? 0, low.get(to) ?? 0));
			} else if (onStack.has(to)) {
				low.set(v, Math.min(low.get(v) ?? 0, index.get(to) ?? 0));
			}
		}
		if (low.get(v) === index.get(v)) {
			const component: string[] = [];
			let w: string | undefined;
			do {
				w = stack.pop();
				if (w === undefined) break;
				onStack.delete(w);
				component.push(w);
			} while (w !== v);
			components.push(component);
		}
	};
	for (const v of adjacency.keys()) {
		if (!index.has(v)) visit(v);
	}

	for (const component of components) {
		const members = new Set(component);
		const start = [...component].sort(compare)[0];
		if (start === undefined) continue;
		const selfLoop = (adjacency.get(start) ?? []).find((e) => e.to === start);
		if (component.length === 1 && selfLoop === undefined) continue;

		// Shortest path start → … → start inside the component (BFS, sorted neighbours).
		const cycle = shortestPath(start, start, (v) => (adjacency.get(v) ?? []).filter((e) => members.has(e.to)));
		if (cycle === undefined) continue;
		const names = [start, ...cycle.map((e) => e.to)];
		const second = names[1] ?? start;
		out.push(violation('BND002', start, second, cycle[0]?.section ?? null, `cycle ${names.join(ARROW)}`, names));
	}
}

/** BFS for the shortest edge chain from `from` to `to` (`from === to` finds the shortest cycle). */
function shortestPath(from: string, to: string, next: (v: string) => readonly Edge[]): Edge[] | undefined {
	const previous = new Map<string, { parent: string; edge: Edge }>();
	const queue: string[] = [from];
	const seen = new Set<string>(from === to ? [] : [from]);
	// Array iteration sees elements pushed during the loop, so this walks the queue breadth-first.
	for (const v of queue) {
		for (const edge of next(v)) {
			if (edge.to === to) {
				const chain: Edge[] = [edge];
				let cursor = v;
				while (cursor !== from) {
					const step = previous.get(cursor);
					if (step === undefined) break;
					chain.unshift(step.edge);
					cursor = step.parent;
				}
				return chain;
			}
			if (!seen.has(edge.to)) {
				seen.add(edge.to);
				previous.set(edge.to, { parent: v, edge });
				queue.push(edge.to);
			}
		}
	}
	return undefined;
}

/**
 * BND006: the transitive `@idp/*` closure of `from` must not contain `to`, nor any member declaring a third-party `to`.
 *
 * All four manifest sections count as edges, devDependencies included: a dev edge still lets the package's tests
 * (and anything they build) load the forbidden code, which is exactly what R3.1 ("no LLM on the replay path") forbids.
 */
function checkForbiddenReach(graph: WorkspaceGraph, model: LayerModel, out: BoundaryViolation[]): void {
	const next = (v: string): Edge[] => {
		const node = graph.get(v);
		return node === undefined ? [] : scopedEdges(node, new Set());
	};
	for (const { from, to } of model.forbiddenReach) {
		if (!graph.has(from)) continue;
		let chain: Edge[] | undefined;
		if (to.startsWith(SCOPE)) {
			chain = shortestPath(from, to, next);
		} else {
			// Third-party target: shortest path to any closure member (including `from`) that declares it.
			const declares = (v: string): Edge | undefined => {
				const node = graph.get(v);
				return node === undefined ? undefined : edgesOf(node).find((e) => e.to === to);
			};
			const direct = declares(from);
			if (direct !== undefined) {
				chain = [direct];
			} else {
				const withLeaf = (v: string): Edge[] => {
					const edges = next(v);
					const leaf = declares(v);
					return leaf === undefined ? edges : [leaf, ...edges];
				};
				chain = shortestPath(from, to, withLeaf);
			}
		}
		if (chain === undefined) continue;
		const names = [from, ...chain.map((e) => e.to)];
		out.push(
			violation(
				'BND006',
				from,
				to,
				chain[0]?.section ?? null,
				`${from} must never reach ${to}: ${names.join(ARROW)}`,
				names,
			),
		);
	}
}

function order(a: BoundaryViolation, b: BoundaryViolation): number {
	return (
		compare(a.code, b.code) ||
		compare(a.package, b.package) ||
		compare(a.dependency, b.dependency) ||
		compare(a.section ?? '', b.section ?? '') ||
		compare(a.path.join(ARROW), b.path.join(ARROW))
	);
}

/**
 * Checks every workspace manifest against the layer model. Pure and deterministic: no I/O, output sorted by
 * code, then package, then dependency.
 */
export function checkBoundaries(graph: WorkspaceGraph, model: LayerModel): BoundaryViolation[] {
	const out: BoundaryViolation[] = [];
	checkEdges(graph, model, out);
	checkCycles(graph, model, out);
	checkForbiddenReach(graph, model, out);
	return out.sort(order);
}
