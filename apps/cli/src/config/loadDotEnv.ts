import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

/**
 * Loads `<repoRoot>/.env` (gitignored; keys in `.env.example`) into `env` without overriding a variable that is
 * already set (the shell wins). Skipped when `IDP_NO_DOTENV=1` (tests) or when there is no `.env`. Returns
 * whether a file was loaded. It never prints a value.
 */
export function loadDotEnv(repoRoot: string, env: Record<string, string | undefined>): boolean {
	if (env['IDP_NO_DOTENV'] === '1') return false;
	const file = path.join(repoRoot, '.env');
	if (!existsSync(file)) return false;
	for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
		if (env[key] === undefined && value !== undefined) env[key] = value;
	}
	return true;
}
