/**
 * The directory user-supplied relative paths (`--artifact`, `--out`, `--profile <path>`, `--model
 * scripted:<file>`, `--token-file`, `--runs-root`) resolve against: `INIT_CWD` (pnpm sets it to the directory
 * `pnpm idp …` was typed in, while the script itself runs in `apps/cli`), else the process cwd.
 */
export function invocationDir(env: Readonly<Record<string, string | undefined>>, cwd: string): string {
	const init = env['INIT_CWD'];
	return init === undefined || init === '' ? cwd : init;
}
