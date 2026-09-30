// The `discover` command: the only module of the CLI that imports `@idp/agent` (and so the only one that may
// construct a model). main.ts loads it with a dynamic import, so `replay`/`catalog`/`operator` never load it.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { OutputSpec, ParamSpec, RunResult } from '@idp/artifact-schema';
import {
	AnthropicModelClient,
	DiscoveryRunner,
	ScriptedModel,
	type DiscoverySessionInfo,
	type ModelClient,
} from '@idp/agent';
import type { Redacted } from '@idp/policy';
import { parseCommandArgs } from '../args/parseCommandArgs.js';
import { parseKeyValues } from '../args/parseKeyValues.js';
import { parseOutputFlag } from '../args/parseOutputFlag.js';
import { removeControlFiles, writeControlFiles } from '../operator/writeControlFiles.js';
import type { CommandSpec } from '../args/CommandSpec.js';
import { displayPath, userPath, type CliContext } from '../cli/CliContext.js';
import { EXIT } from '../cli/exitCodes.js';
import { EnvCredentialProvider } from '../config/EnvCredentialProvider.js';
import { loadConfig } from '../config/loadConfig.js';
import { DEFAULT_PROFILE } from '../config/resolveProfilePath.js';
import { CliUsageError } from '../errors/CliUsageError.js';
import { summarize } from '../output/printResult.js';
import { resolveRunsRoot } from '../paths/resolveRunsRoot.js';
import { runReplay } from '../replay/runReplay.js';
import { controlPortFrom } from './controlPort.js';

/** The `discover` command: flags, usage, examples and exit codes (the source of `idp discover --help`). */
export const spec = {
	name: 'discover',
	summary:
		'idp discover — let a model drive the live app to a goal, compile the run into a capability artifact, verify it by replay, save it.',
	usage:
		'idp discover --goal <text> --input <name>=<value> ... [--sensitive <name> ...] [--output <name>:<type> ...] --model <scripted:<file>|anthropic> [--id <id>] [--out <file>]',
	options: {
		goal: {
			type: 'string',
			valueName: 'text',
			description: 'The natural-language goal (example values in it are placeholderized).',
		},
		input: {
			type: 'string',
			multiple: true,
			valueName: 'name=value',
			description: 'An example input; each becomes a string param of the capability.',
		},
		sensitive: {
			type: 'string',
			multiple: true,
			valueName: 'name',
			description: 'Mark an input param sensitive (redacted everywhere, never stored). Other inputs are not sensitive.',
		},
		output: {
			type: 'string',
			multiple: true,
			valueName: 'name:type',
			description:
				'Declare an output (type string|integer|decimal[:scale], scale default 2; always sensitive). When given, these are the complete output list; omit to keep the outputs the model declares. boolean is not supported: extract reads text, so declare a yes/no value as string.',
		},
		model: {
			type: 'string',
			valueName: 'scripted:<file>|anthropic',
			description:
				'The model: a scripted fake (no API key, no cost) or Claude (needs ANTHROPIC_API_KEY; model $IDP_MODEL).',
		},
		id: {
			type: 'string',
			valueName: 'id',
			description: 'The capability id (kebab-case; default: derived from the goal).',
		},
		title: {
			type: 'string',
			valueName: 'text',
			description: 'The capability title (default: the goal’s first sentence).',
		},
		target: {
			type: 'string',
			valueName: 'route',
			description: 'The entry route to open first (default: the profile’s loginRoute).',
		},
		profile: {
			type: 'string',
			valueName: 'name|file',
			default: DEFAULT_PROFILE,
			description: 'App profile: a name in config/apps/ (mock-bank, mock-bank.tenant-b) or a JSON file.',
		},
		out: {
			type: 'string',
			valueName: 'file',
			description: 'Where to save the artifact (default: <repo>/artifacts/<id>.json).',
		},
		'verify-replay': {
			type: 'boolean',
			default: true,
			negatable: true,
			description: 'Replay the new artifact once with the example inputs; save it only if that replay succeeds.',
		},
		attended: {
			type: 'boolean',
			description:
				'An operator is present: interventions wait for them. The control URL and token file are printed (the token never is); `idp operator` finds the session.',
		},
		headed: { type: 'boolean', description: 'Show the browser window (default: headless).' },
		'runs-root': {
			type: 'string',
			valueName: 'dir',
			description: 'Where run directories go (default: $IDP_RUNS_ROOT or <repo>/.runs).',
		},
	},
	examples: [
		'pnpm idp discover --model scripted:packages/agent/scripts/member-lookup.script.json --goal "look up member <member-number> and read their current savings balance" --input memberId=<member-number> --sensitive memberId --output savingsBalance:decimal:2 --output memberName:string --id member-lookup --out artifacts/member-lookup.json',
		'pnpm idp discover --model anthropic --goal "look up member <member-number> and read their current savings balance" --input memberId=<member-number> --sensitive memberId --id member-lookup',
	],
	notes: [
		'Params: each --input becomes a required string param (no pattern) named after its key; tighten the type in the artifact afterwards if needed (any edit changes the content hash: re-hash it).',
		'Output: the redacted discovery outcome, the discovery run dir, the verify-replay summary and run dir, and the saved artifact path. Example inputs, credentials and extracted values are never printed.',
		'Exit codes: 0 goal met (and verified, and saved), 4 discovery stopped without meeting the goal, 1 failure (the model API failed after its retries, verify-replay did not succeed, missing ANTHROPIC_API_KEY, config or credential error), 64 usage error.',
		'Env: ANTHROPIC_API_KEY and IDP_MODEL (--model anthropic only), MOCKBANK_ORIGIN / MOCKBANK_PORT, MOCKBANK_OPERATOR_USER / MOCKBANK_OPERATOR_PASSWORD, IDP_CONTROL_PORT, IDP_RUNS_ROOT. Read from .env at the repo root when present (skipped with IDP_NO_DOTENV=1).',
	],
} as const satisfies CommandSpec;

/** `--model scripted:<file>` or `--model anthropic`. Built before any browser starts (a missing key fails fast). */
async function createModel(value: string | undefined, context: CliContext): Promise<ModelClient> {
	if (value === 'anthropic') return new AnthropicModelClient({ env: context.env });
	if (value?.startsWith('scripted:') === true && value.length > 'scripted:'.length) {
		return ScriptedModel.fromFile(userPath(context, value.slice('scripted:'.length)));
	}
	throw new CliUsageError('--model must be scripted:<file> or anthropic', spec.name);
}

function paramSpecs(inputs: Readonly<Record<string, string>>, sensitive: ReadonlySet<string>): ParamSpec[] {
	for (const name of sensitive) {
		if (!Object.hasOwn(inputs, name)) throw new CliUsageError(`--sensitive ${name} names no --input`, spec.name);
	}
	return Object.keys(inputs).map((name) => {
		if (!/^[a-z][a-zA-Z0-9]*$/.test(name)) {
			throw new CliUsageError(`--input ${name}: the name must be a camelCase identifier`, spec.name);
		}
		return {
			name,
			description: `The ${name} input (declared with --input).`,
			type: { kind: 'string' },
			required: true,
			sensitive: sensitive.has(name),
		};
	});
}

/**
 * `--output name:type` for discovery. `boolean` is refused: an extract step has no boolean parse (text, decimal,
 * integer), so the value would be a string and the output would fail validation on every replay.
 */
function parseDiscoverOutput(flag: string): OutputSpec {
	const output = parseOutputFlag(flag);
	if (output.type.kind === 'boolean') {
		throw new CliUsageError(
			`--output ${flag}: boolean outputs are not supported (extract reads text); declare it as ${output.name}:string`,
			spec.name,
		);
	}
	return output;
}

/** Prints where an attended discovery session's control API is and writes its control files (never the token). */
async function announceControl(context: CliContext, session: DiscoverySessionInfo): Promise<void> {
	if (session.controlUrl === null || session.controlToken === null) return;
	const { printer } = context;
	printer.redactor.addSensitiveValue(session.controlToken);
	const files = await writeControlFiles(session.runDir, {
		controlUrl: session.controlUrl,
		controlToken: session.controlToken,
	});
	printer.line(`attended session: control API at ${files.controlUrl}`);
	printer.line(`control token written to ${displayPath(context, files.tokenFile)} (mode 0600; it is not printed)`);
	printer.line(
		`operator console: pnpm idp operator --control-url ${files.controlUrl} --token-file ${displayPath(context, files.tokenFile)}`,
	);
}

/**
 * Runs `idp discover`: the discovery loop, compilation, verify-replay and save; returns 0, 4 (stopped) or 1
 * (a model API failure, or verify-replay did not succeed).
 * @throws CliUsageError on bad flags; ConfigError on config, credential or model setup errors.
 */
export async function run(args: readonly string[], context: CliContext): Promise<number> {
	const values = parseCommandArgs(spec, args);
	if (values.goal === undefined || values.goal.trim() === '')
		throw new CliUsageError('--goal <text> is required', spec.name);
	const inputs = parseKeyValues(values.input, '--input');
	const sensitive = new Set(values.sensitive ?? []);
	const params = paramSpecs(inputs, sensitive);
	const outputs: OutputSpec[] | undefined = values.output?.map(parseDiscoverOutput);
	const { printer, env } = context;
	// Seed the printer before anything is printed: example inputs (sensitive or not, they are concrete values).
	for (const [name, value] of Object.entries(inputs)) printer.redactor.addSensitiveValue({ value, paramName: name });

	const model = await createModel(values.model, context);
	const config = await loadConfig({ ...context, env, profile: values.profile });
	const credentials = new EnvCredentialProvider(env);
	const credential = await credentials.resolve(config.profile.credentialRef);
	printer.redactor.addSensitiveValue(credential.username);
	printer.redactor.addSensitiveValue(credential.password);
	const runsRoot = resolveRunsRoot(context, env, values['runs-root']);

	printer.line(`discovering with ${model.modelId} against ${config.origin} (profile ${config.profile.variant})`);
	const discovery = await new DiscoveryRunner({
		goal: values.goal,
		params,
		exampleInputs: inputs,
		...(outputs === undefined ? {} : { outputs }),
		credentials: credential,
		profile: config.profile,
		policy: config.policy,
		model,
		runsRoot,
		...(values.target === undefined ? {} : { target: values.target }),
		attended: values.attended === true,
		headless: values.headed !== true,
		...(values.attended === true ? { controlPort: controlPortFrom(env) } : {}),
		...(values.id === undefined ? {} : { id: values.id }),
		...(values.title === undefined ? {} : { title: values.title }),
		...(values.attended === true
			? {
					onSessionOpen: (session: DiscoverySessionInfo) => announceControl(context, session),
					onSessionClosed: (session: DiscoverySessionInfo) => removeControlFiles(session.runDir),
				}
			: {}),
	}).run();
	printer.line(`discovery run dir: ${displayPath(context, discovery.runDir)}`);

	const { outcome, artifact } = discovery;
	if (outcome.kind === 'stopped') {
		printer.line(`discovery stopped: ${outcome.reason} after ${outcome.turns} model turn(s): ${outcome.detail}`);
		if (outcome.reason === 'model_error') {
			printer.error(
				`the model API failed after its retries (${outcome.retryable === true ? 'transient: try again later' : 'not retryable'})`,
			);
			return EXIT.failure;
		}
		return EXIT.discoveryStopped;
	}
	if (artifact === undefined) throw new Error('discovery met its goal but returned no artifact');
	printer.line(
		`discovery goal met after ${outcome.turns} model turn(s): compiled ${artifact.id}@${artifact.version} (${artifact.steps.length} steps) → ${discovery.artifactPath === undefined ? '' : displayPath(context, discovery.artifactPath)}`,
	);

	if (values['verify-replay']) {
		printer.line('verify-replay: replaying the new artifact once with the example inputs');
		const verify = await runReplay({
			document: artifact,
			artifact,
			params: inputs,
			config,
			credentials,
			sensitiveValues: [credential.username, credential.password],
			runsRoot,
			attended: false,
			headed: values.headed === true,
		});
		printer.useRedactor(verify.redactor);
		printer.line(`verify-replay ${summarize(verify.result, verify.redactor, artifact.outputs)}`);
		printer.line(`verify-replay run dir: ${displayPath(context, verify.runDir)}`);
		if (!isSuccess(verify.result)) {
			printer.error('verify-replay did not succeed: the artifact was not saved (it stays in the discovery run dir)');
			return EXIT.failure;
		}
	} else {
		printer.line('verify-replay skipped (--no-verify-replay)');
	}

	const out =
		values.out === undefined
			? path.join(context.repoRoot, 'artifacts', `${artifact.id}.json`)
			: userPath(context, values.out);
	await mkdir(path.dirname(out), { recursive: true });
	// The artifact is sink-safe: the agent's assertNoConcreteValues proved it holds no example input, credential or
	// extracted value (it is the same document the discovery run wrote as artifact.json).
	const safe = artifact as Redacted<typeof artifact>;
	await writeFile(out, `${JSON.stringify(safe, null, '\t')}\n`);
	printer.line(`artifact saved: ${displayPath(context, out)}`);
	return EXIT.success;
}

function isSuccess(result: RunResult): boolean {
	return result.kind === 'success';
}
