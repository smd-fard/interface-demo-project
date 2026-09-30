// The `replay` command. Deterministic: it never imports `@idp/agent` (invariant 1, R3.1) — neither directly nor
// through any module it imports — and main.ts loads it with a dynamic import, so `idp replay` never loads the agent.
import { parseCommandArgs } from '../args/parseCommandArgs.js';
import { parseKeyValues } from '../args/parseKeyValues.js';
import type { CommandSpec } from '../args/CommandSpec.js';
import { displayPath, userPath, type CliContext } from '../cli/CliContext.js';
import { exitCodeFor } from '../cli/exitCodes.js';
import { EnvCredentialProvider } from '../config/EnvCredentialProvider.js';
import { loadConfig } from '../config/loadConfig.js';
import { DEFAULT_PROFILE } from '../config/resolveProfilePath.js';
import { CliUsageError } from '../errors/CliUsageError.js';
import { removeControlFiles, writeControlFiles } from '../operator/writeControlFiles.js';
import { printResult } from '../output/printResult.js';
import { resolveRunsRoot } from '../paths/resolveRunsRoot.js';
import { attendedWarning } from '../replay/attendedWarning.js';
import { loadArtifactFile } from '../replay/loadArtifactFile.js';
import { runReplay } from '../replay/runReplay.js';
import { controlPortFrom } from './controlPort.js';

/** The `replay` command: flags, usage, examples and exit codes (the source of `idp replay --help`). */
export const spec = {
	name: 'replay',
	summary: 'idp replay — run a capability artifact deterministically (no LLM) against the live app.',
	usage: 'idp replay --artifact <file> [--param <name>=<value> ...] [--profile <name|file>] [--attended] [--headed]',
	options: {
		artifact: {
			type: 'string',
			valueName: 'file',
			description: 'The capability artifact to run, e.g. artifacts/member-lookup.json.',
		},
		param: { type: 'string', multiple: true, valueName: 'name=value', description: 'A capability param.' },
		profile: {
			type: 'string',
			valueName: 'name|file',
			default: DEFAULT_PROFILE,
			description: 'App profile: a name in config/apps/ (mock-bank, mock-bank.tenant-b) or a JSON file.',
		},
		attended: {
			type: 'boolean',
			description:
				'An operator is present: approvals and takeovers wait for them. Prints the control URL and the token file for `idp operator`.',
		},
		headed: {
			type: 'boolean',
			description:
				'Show the browser window (default: headless). An attended takeover needs it; while no operator holds control the window blocks all input.',
		},
		'runs-root': {
			type: 'string',
			valueName: 'dir',
			description: 'Where run directories go (default: $IDP_RUNS_ROOT or <repo>/.runs).',
		},
	},
	examples: [
		'pnpm idp replay --artifact artifacts/member-lookup.json --param memberId=<member-number>',
		'pnpm idp replay --artifact artifacts/open-sub-account.json --param memberId=<member-number> --param "product=Holiday Club" --param initialDeposit=<amount> --param nickname=<nickname> --attended --headed',
	],
	notes: [
		'Params: <member-number> is a synthetic 5-digit member number (seed data: apps/mock-bank/README.md); <amount> is a decimal with 2 places, e.g. an initial deposit (amounts are masked in all output).',
		'Output: the redacted RunResult as JSON (as in <run dir>/result.json; sensitive outputs are [REDACTED]), then a one-line summary and the run dir.',
		'Exit codes: 0 success, 3 business outcome (e.g. member_not_found), 1 failure or error, 64 usage error.',
		'Env: MOCKBANK_ORIGIN (default http://127.0.0.1:$MOCKBANK_PORT, port 4010), MOCKBANK_OPERATOR_USER / MOCKBANK_OPERATOR_PASSWORD (credential ref mockbank-operator), IDP_CONTROL_PORT (attended; default 4020), IDP_RUNS_ROOT. Read from .env at the repo root when present.',
	],
} as const satisfies CommandSpec;

/**
 * Runs `idp replay`: loads config and artifact, replays it (no LLM), prints the redacted result; returns the exit code for the result.
 * @throws CliUsageError on bad flags; ConfigError / ArtifactFileError before any browser starts.
 */
export async function run(args: readonly string[], context: CliContext): Promise<number> {
	const values = parseCommandArgs(spec, args);
	if (values.artifact === undefined) throw new CliUsageError('--artifact <file> is required', spec.name);
	const params = parseKeyValues(values.param, '--param');
	const attended = values.attended === true;
	const { printer, env } = context;
	const warning = attendedWarning({ attended, headed: values.headed === true });
	if (warning !== null) printer.error(warning);

	const config = await loadConfig({ ...context, env, profile: values.profile });
	const { document, artifact } = await loadArtifactFile(userPath(context, values.artifact));
	const credentials = new EnvCredentialProvider(env);
	const credentialRef = artifact.credentialRef;
	const sensitiveValues = credentialRef === undefined ? [] : credentials.knownValues(credentialRef);
	// Fail fast, before a browser starts, when the artifact signs on and its credential is not configured.
	if (credentialRef !== undefined) await credentials.resolve(credentialRef);
	for (const value of sensitiveValues) printer.redactor.addSensitiveValue(value);
	for (const param of artifact.params) {
		const value = params[param.name];
		if (param.sensitive && value !== undefined) printer.redactor.addSensitiveValue({ value, paramName: param.name });
	}

	const run = await runReplay({
		document,
		artifact,
		params,
		config,
		credentials,
		sensitiveValues,
		runsRoot: resolveRunsRoot(context, env, values['runs-root']),
		attended,
		headed: values.headed === true,
		controlPort: controlPortFrom(env),
		onSessionOpen: async (session) => {
			if (!attended || session.controlUrl === null || session.controlToken === null) return;
			printer.redactor.addSensitiveValue(session.controlToken);
			const files = await writeControlFiles(session.runDir.path, {
				controlUrl: session.controlUrl,
				controlToken: session.controlToken,
			});
			printer.line(`attended session: control API at ${files.controlUrl}`);
			printer.line(`control token written to ${displayPath(context, files.tokenFile)} (mode 0600; it is not printed)`);
			printer.line(
				`operator console: pnpm idp operator --control-url ${files.controlUrl} --token-file ${displayPath(context, files.tokenFile)}`,
			);
		},
		onSessionClosed: async (session) => {
			if (attended) await removeControlFiles(session.runDir.path);
		},
	});
	printResult(printer, {
		result: run.result,
		redactor: run.redactor,
		outputs: artifact.outputs,
		runDir: displayPath(context, run.runDir),
	});
	return exitCodeFor(run.result);
}
