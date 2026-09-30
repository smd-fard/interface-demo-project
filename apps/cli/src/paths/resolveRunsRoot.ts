import path from 'node:path';

/** The two anchors for paths: the repo root (config, artifacts, `.runs`) and the invocation dir (relative flags). */
export interface PathContext {
	readonly repoRoot: string;
	readonly invocationDir: string;
}

/**
 * The runs root (each run writes `<runsRoot>/<runId>/`): `--runs-root`, else `IDP_RUNS_ROOT` (both relative to
 * the invocation dir), else `<repo>/.runs` (gitignored).
 */
export function resolveRunsRoot(
	context: PathContext,
	env: Readonly<Record<string, string | undefined>>,
	flag: string | undefined,
): string {
	const chosen = flag ?? (env['IDP_RUNS_ROOT'] === '' ? undefined : env['IDP_RUNS_ROOT']);
	return chosen === undefined ? path.join(context.repoRoot, '.runs') : path.resolve(context.invocationDir, chosen);
}
