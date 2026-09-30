import path from 'node:path';
import type { PathContext } from '../paths/resolveRunsRoot.js';

/** The default app profile (`config/apps/mock-bank.profile.json`). */
export const DEFAULT_PROFILE = 'mock-bank';

/**
 * `--profile` accepts a profile name (`mock-bank`, `mock-bank.tenant-b` → `<repo>/config/apps/<name>.profile.json`)
 * or a path (a value with a slash or ending in `.json`, relative to the invocation dir).
 */
export function resolveProfilePath(value: string, context: PathContext): string {
	if (value.includes('/') || value.includes(path.sep) || value.endsWith('.json')) {
		return path.resolve(context.invocationDir, value);
	}
	return path.join(context.repoRoot, 'config', 'apps', `${value}.profile.json`);
}
