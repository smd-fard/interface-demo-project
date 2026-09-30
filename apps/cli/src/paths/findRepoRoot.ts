import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError } from '../errors/ConfigError.js';

/**
 * The monorepo root: the nearest ancestor of `fromUrl` (a module URL, e.g. `import.meta.url` of `dist/main.js`)
 * holding `pnpm-workspace.yaml`. Default paths (`config/`, `artifacts/`, `.runs/`) resolve against it, so the
 * CLI works whatever directory `pnpm idp` runs it from (pnpm runs it with cwd `apps/cli`).
 */
export function findRepoRoot(fromUrl: string): string {
	let dir = path.dirname(fileURLToPath(fromUrl));
	for (;;) {
		if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) throw new ConfigError('config_not_found', 'no pnpm-workspace.yaml above the idp CLI');
		dir = parent;
	}
}
