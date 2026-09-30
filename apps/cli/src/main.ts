#!/usr/bin/env node
// The `idp` bin. Each command lives in its own module and is loaded with a dynamic `import()` only when run, so
// `idp replay` / `idp catalog` / `idp operator` never load `@idp/agent` (invariant 1): only
// `commands/discover.ts` imports it.
import { createRedactor, DEFAULT_REDACTION_CONFIG } from '@idp/policy';
import { formatHelp } from './args/formatHelp.js';
import type { CliContext } from './cli/CliContext.js';
import type { CommandModule } from './cli/Command.js';
import { EXIT } from './cli/exitCodes.js';
import { loadDotEnv } from './config/loadDotEnv.js';
import { CliUsageError } from './errors/CliUsageError.js';
import { Printer } from './output/Printer.js';
import { findRepoRoot } from './paths/findRepoRoot.js';
import { invocationDir } from './paths/invocationDir.js';

const COMMANDS: Readonly<Record<string, { readonly summary: string; readonly load: () => Promise<CommandModule> }>> = {
	discover: {
		summary: 'Let a model drive the live app to a goal and compile a capability artifact (verified by replay).',
		load: () => import('./commands/discover.js'),
	},
	replay: {
		summary: 'Run a capability artifact deterministically (no LLM); prints the redacted RunResult.',
		load: () => import('./commands/replay.js'),
	},
	catalog: {
		summary: 'List the capability artifacts and verify their content hashes.',
		load: () => import('./commands/catalog.js'),
	},
	operator: {
		summary: 'Open the operator console for a running attended session.',
		load: () => import('./commands/operator.js'),
	},
};

/** Env values that must never be printed, whatever a message contains. */
const SECRET_ENV_KEYS = /(_PASSWORD|_TOKEN|_API_KEY|_SECRET|_USER)$/;

function topLevelHelp(): string {
	const width = Math.max(...Object.keys(COMMANDS).map((name) => name.length)) + 2;
	return [
		'idp — computer-use automation for legacy bank back-office apps.',
		'',
		'Usage:',
		'  idp <command> [flags]      (from the repo: pnpm idp <command> [flags])',
		'',
		'Commands:',
		...Object.entries(COMMANDS).map(([name, command]) => `  ${name.padEnd(width)}${command.summary}`),
		'',
		'Run `idp <command> --help` for its flags.',
		'',
		'Exit codes: 0 success / goal met, 3 business outcome, 1 failure or error, 4 discovery stopped, 64 usage error.',
		'Paths: config/, artifacts/ and .runs/ resolve against the repo root; relative paths given in flags resolve against',
		'the directory pnpm was invoked from (INIT_CWD), else the current directory. .env at the repo root is loaded',
		'when present (never overriding the shell; skipped with IDP_NO_DOTENV=1), and its values are never printed.',
	].join('\n');
}

function isHelp(arg: string | undefined): boolean {
	return arg === '--help' || arg === '-h' || arg === 'help';
}

function errorCode(error: Error): string {
	const code = (error as { code?: unknown }).code;
	return typeof code === 'string' ? code : error.name;
}

function report(printer: Printer, error: unknown, env: Readonly<Record<string, string | undefined>>): number {
	if (error instanceof CliUsageError) {
		printer.error(`usage error: ${error.message}`);
		printer.error(error.command === null ? 'Run `idp --help`.' : `Run \`idp ${error.command} --help\`.`);
		return EXIT.usage;
	}
	if (error instanceof Error) {
		printer.error(`error [${errorCode(error)}]: ${error.message}`);
		if (env['IDP_DEBUG'] === '1' && error.stack !== undefined) printer.error(error.stack);
		return EXIT.failure;
	}
	printer.error('error: a non-Error value was thrown');
	return EXIT.failure;
}

/**
 * The `idp` entry point: loads `.env`, seeds the base redactor with secret-looking env values, dispatches the
 * command by dynamic `import()` (so `replay`/`catalog`/`operator` never load `@idp/agent`) and maps errors to
 * exit codes. Returns the exit code; never throws.
 */
export async function main(argv: readonly string[]): Promise<number> {
	const env = process.env;
	const redactor = createRedactor({ config: { redaction: DEFAULT_REDACTION_CONFIG }, sensitiveValues: [] });
	const printer = new Printer(process.stdout, process.stderr, redactor);
	try {
		const repoRoot = findRepoRoot(import.meta.url);
		loadDotEnv(repoRoot, env);
		for (const [key, value] of Object.entries(env)) {
			if (SECRET_ENV_KEYS.test(key) && value !== undefined && value.trim() !== '') redactor.addSensitiveValue(value);
		}
		// `pnpm idp …` runs `pnpm --filter @idp/cli start -- …`, which passes the `--` separator through.
		const [name, ...args] = argv[0] === '--' ? argv.slice(1) : argv;
		if (name === undefined || isHelp(name)) {
			if (name === undefined) {
				printer.error(topLevelHelp());
				return EXIT.usage;
			}
			printer.line(topLevelHelp());
			return EXIT.success;
		}
		const command = COMMANDS[name];
		if (command === undefined) throw new CliUsageError(`unknown command "${name}"`);
		const module = await command.load();
		if (args.some((arg) => arg === '--help' || arg === '-h')) {
			printer.line(formatHelp(module.spec));
			return EXIT.success;
		}
		const context: CliContext = { printer, env, repoRoot, invocationDir: invocationDir(env, process.cwd()) };
		return await module.run(args, context);
	} catch (error) {
		return report(printer, error, env);
	}
}

process.exitCode = await main(process.argv.slice(2));
