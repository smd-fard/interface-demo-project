import { ControlClient } from '@idp/session';
import { loadOperatorConfig, type OperatorConfig } from './config.js';
import { OperatorConfigError } from './errors/OperatorConfigError.js';
import { OperatorServer } from './server.js';

/** sysexits EX_USAGE: the console was started without a usable configuration. */
const EXIT_USAGE = 64;

/** Describes an error for stderr: its name, stable code and message (these never carry the token). */
function describe(error: unknown): string {
	if (!(error instanceof Error)) return 'unknown error';
	const code = (error as { code?: unknown }).code;
	return `${error.name}${typeof code === 'string' ? ` ${code}` : ''}: ${error.message}`;
}

/**
 * Process entry: reads the environment, starts the console on 127.0.0.1, prints `operator console at <url>`
 * (never the token), and stops on SIGTERM/SIGINT. A missing or invalid configuration exits 64.
 */
async function main(): Promise<void> {
	let config: OperatorConfig;
	try {
		config = loadOperatorConfig(process.env);
	} catch (error) {
		if (!(error instanceof OperatorConfigError)) throw error;
		process.stderr.write(`operator: ${error.message}\n`);
		process.exit(EXIT_USAGE);
	}
	const control = new ControlClient({ url: config.controlUrl, token: config.controlToken });
	const server = await OperatorServer.start({
		control,
		port: config.port,
		onError: (error) => process.stderr.write(`operator: unexpected error: ${describe(error)}\n`),
	});
	process.stdout.write(`operator console at ${server.url}\n`);

	let stopping = false;
	const stop = (signal: NodeJS.Signals): void => {
		if (stopping) return;
		stopping = true;
		server.close().then(
			() => process.exit(0),
			(error: unknown) => {
				process.stderr.write(`operator: error while stopping on ${signal}: ${describe(error)}\n`);
				process.exit(1);
			},
		);
	};
	process.on('SIGTERM', stop);
	process.on('SIGINT', stop);
}

main().catch((error: unknown) => {
	process.stderr.write(`operator: failed to start: ${describe(error)}\n`);
	process.exit(1);
});
