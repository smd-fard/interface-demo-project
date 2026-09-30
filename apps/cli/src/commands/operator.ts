// The `operator` command: starts the operator console app as a separate process, by path (apps/operator is a peer
// app; the CLI never imports it), handing it the control URL and token of a running attended session.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { parseCommandArgs } from '../args/parseCommandArgs.js';
import type { CommandSpec } from '../args/CommandSpec.js';
import { userPath, type CliContext } from '../cli/CliContext.js';
import { EXIT } from '../cli/exitCodes.js';
import { CliUsageError } from '../errors/CliUsageError.js';
import { OperatorLaunchError } from '../errors/OperatorLaunchError.js';
import { findLatestControl } from '../operator/findLatestControl.js';
import { removeConsoleKey, writeConsoleKey } from '../operator/writeConsoleKey.js';
import type { Printer } from '../output/Printer.js';
import { resolveRunsRoot } from '../paths/resolveRunsRoot.js';

/** The operator console port (`IDP_OPERATOR_PORT`, default 4030). */
export const DEFAULT_OPERATOR_PORT = '4030';

/** The `operator` command: flags, usage, examples and exit codes (the source of `idp operator --help`). */
export const spec = {
	name: 'operator',
	summary: 'idp operator — open the (deliberately minimal) operator console for a running attended session.',
	usage: 'idp operator [--control-url <url> --token-file <file>] [--port <port>]',
	options: {
		'control-url': {
			type: 'string',
			valueName: 'url',
			description:
				'The session control API URL printed by `idp replay --attended` (default: the latest attended session).',
		},
		'token-file': {
			type: 'string',
			valueName: 'file',
			description:
				'The 0600 file holding the control token (<run dir>/control.token), printed by `idp replay --attended`.',
		},
		port: { type: 'string', valueName: 'port', description: 'Console port (default: $IDP_OPERATOR_PORT or 4030).' },
		'runs-root': {
			type: 'string',
			valueName: 'dir',
			description: 'Where to look for the latest attended session (default: $IDP_RUNS_ROOT or <repo>/.runs).',
		},
	},
	examples: [
		'pnpm idp operator',
		'pnpm idp operator --control-url http://127.0.0.1:4020 --token-file .runs/<run id>/control.token',
	],
	notes: [
		'Without --control-url/--token-file it uses the most recent <runs root>/*/control.json written by a running `idp replay --attended` (removed when that session ends).',
		'Runs node apps/operator/dist/main.js (build it first: pnpm --filter @idp/operator build) with IDP_CONTROL_URL, IDP_CONTROL_TOKEN, IDP_OPERATOR_KEY and IDP_OPERATOR_PORT. The control token is never printed.',
		'The console requires a login: open the one-time URL it prints (http://127.0.0.1:<port>/login?k=<console key>); it sets an HttpOnly session cookie and the key stops working. The console key is a separate random value (not the control token), written to operator.key (mode 0600) next to the token file and removed when the console exits.',
		'Exit codes: the console’s own exit code; 1 when it cannot start; 64 usage error.',
	],
} as const satisfies CommandSpec;

async function readToken(file: string): Promise<string> {
	let token: string;
	try {
		token = (await readFile(file, 'utf8')).trim();
	} catch (error) {
		throw new OperatorLaunchError('token_file_unreadable', `the token file ${file} cannot be read`, { cause: error });
	}
	if (token === '') throw new OperatorLaunchError('token_file_unreadable', `the token file ${file} is empty`);
	return token;
}

function pipeLines(stream: NodeJS.ReadableStream, write: (line: string) => void): void {
	createInterface({ input: stream, crlfDelay: Infinity }).on('line', write);
}

async function runConsole(main: string, env: NodeJS.ProcessEnv, printer: Printer): Promise<number> {
	const child = spawn(process.execPath, [main], { env, stdio: ['ignore', 'pipe', 'pipe'] });
	// The console's output passes through the redactor too (seeded with the token).
	pipeLines(child.stdout, (line) => printer.line(line));
	pipeLines(child.stderr, (line) => printer.error(line));
	const forward = (signal: NodeJS.Signals) => child.kill(signal);
	process.on('SIGINT', forward);
	process.on('SIGTERM', forward);
	try {
		return await new Promise<number>((resolve, reject) => {
			child.once('error', reject);
			child.once('exit', (code, signal) => resolve(code ?? (signal === null ? EXIT.failure : 0)));
		});
	} finally {
		process.off('SIGINT', forward);
		process.off('SIGTERM', forward);
	}
}

/**
 * Runs `idp operator`: writes a one-time console key (0600, next to the token file), spawns the operator console
 * with the control URL, token and key, removes the key file when it exits; returns its exit code.
 * @throws CliUsageError on bad flags; OperatorLaunchError when no attended session is found or the console cannot start.
 */
export async function run(args: readonly string[], context: CliContext): Promise<number> {
	const values = parseCommandArgs(spec, args);
	const { printer, env } = context;
	let controlUrl = values['control-url'];
	let tokenFile = values['token-file'] === undefined ? undefined : userPath(context, values['token-file']);
	if ((controlUrl === undefined) !== (tokenFile === undefined)) {
		throw new CliUsageError(
			'give both --control-url and --token-file, or neither (latest attended session)',
			spec.name,
		);
	}
	if (controlUrl === undefined || tokenFile === undefined) {
		const runsRoot = resolveRunsRoot(context, env, values['runs-root']);
		const latest = await findLatestControl(runsRoot);
		if (latest === null) {
			throw new OperatorLaunchError(
				'no_attended_session',
				`no running attended session under ${runsRoot}: start one with \`pnpm idp replay … --attended\`, or pass --control-url and --token-file`,
			);
		}
		({ controlUrl, tokenFile } = latest);
	}
	if (!URL.canParse(controlUrl)) throw new CliUsageError('--control-url must be a URL', spec.name);
	const port = values.port ?? (env['IDP_OPERATOR_PORT']?.trim() || DEFAULT_OPERATOR_PORT);
	if (!/^\d{1,5}$/.test(port)) throw new CliUsageError('--port must be a port number', spec.name);

	const main = path.join(context.repoRoot, 'apps', 'operator', 'dist', 'main.js');
	if (!existsSync(main)) {
		throw new OperatorLaunchError('operator_not_built', `${main} not found: run \`pnpm --filter @idp/operator build\``);
	}
	const token = await readToken(tokenFile);
	printer.redactor.addSensitiveValue(token);
	// A separate one-time console login key (never the control token): the console prints its login URL with it.
	const { key, keyFile } = await writeConsoleKey(path.dirname(tokenFile));
	printer.line(
		`operator console for ${controlUrl} on port ${port} (token from ${tokenFile}; console key in ${keyFile})`,
	);
	try {
		return await runConsole(
			main,
			{
				...process.env,
				IDP_CONTROL_URL: controlUrl,
				IDP_CONTROL_TOKEN: token,
				IDP_OPERATOR_KEY: key,
				IDP_OPERATOR_PORT: port,
			},
			printer,
		);
	} finally {
		await removeConsoleKey(keyFile);
	}
}
