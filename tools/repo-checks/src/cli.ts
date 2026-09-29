import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkBoundaries } from './checkBoundaries.js';
import { formatViolations } from './formatViolations.js';
import { loadLayerModel } from './LayerModel.js';
import { LayersConfigError } from './LayersConfigError.js';
import { readWorkspaceGraph } from './readWorkspaceGraph.js';
import { WorkspaceReadError } from './WorkspaceReadError.js';

/** Walks up from `start` to the directory holding `pnpm-workspace.yaml`. */
function findRepoRoot(start: string): string {
	let dir = start;
	for (;;) {
		if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
			return dir;
		}
		const parent = dirname(dir);
		if (parent === dir) {
			throw new WorkspaceReadError(start, 'no pnpm-workspace.yaml found in this directory or any parent');
		}
		dir = parent;
	}
}

function main(): void {
	try {
		const root = findRepoRoot(process.cwd());
		const model = loadLayerModel(fileURLToPath(new URL('../layers.json', import.meta.url)));
		const graph = readWorkspaceGraph(root);
		const violations = checkBoundaries(graph, model);
		if (violations.length > 0) {
			console.error(formatViolations(violations));
			console.error(`boundaries: ${violations.length} violation(s) in ${graph.size} workspaces`);
			process.exitCode = 1;
			return;
		}
		console.log(`boundaries: OK (${graph.size} workspaces)`);
	} catch (error) {
		if (error instanceof LayersConfigError || error instanceof WorkspaceReadError) {
			console.error(`boundaries: ${error.code}: ${error.message}`);
			process.exitCode = 2;
			return;
		}
		throw error;
	}
}

main();
