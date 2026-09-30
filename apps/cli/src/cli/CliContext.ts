import path from 'node:path';
import type { Printer } from '../output/Printer.js';
import type { PathContext } from '../paths/resolveRunsRoot.js';

/** What every command runs with. */
export interface CliContext extends PathContext {
	readonly printer: Printer;
	/** The process env, after `.env` was loaded into it. Never printed. */
	readonly env: Readonly<Record<string, string | undefined>>;
}

/** A user-supplied path, resolved against the invocation dir (`INIT_CWD` under pnpm, else the cwd). */
export function userPath(context: PathContext, value: string): string {
	return path.resolve(context.invocationDir, value);
}

/**
 * A path for display: relative to the invocation dir when it lies under it, so printed output (and evidence
 * copied from it) carries no machine-specific absolute paths. Anything outside the invocation dir stays absolute.
 */
export function displayPath(context: PathContext, value: string): string {
	const relative = path.relative(context.invocationDir, value);
	if (relative === '') return '.';
	return relative.startsWith('..') || path.isAbsolute(relative) ? value : relative;
}
