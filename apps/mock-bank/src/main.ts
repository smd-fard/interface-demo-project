import { loadConfig } from './config.js';
import { MockBankError } from './errors/MockBankError.js';
import { createMockBankServer } from './server.js';

/** Process entry: reads the environment, listens, prints `listening <url>`, and stops on SIGTERM/SIGINT. */
async function main(): Promise<void> {
	const config = loadConfig(process.env);
	const server = createMockBankServer(config);
	const url = await server.listen();
	process.stdout.write(`listening ${url}\n`);

	let stopping = false;
	const stop = (signal: NodeJS.Signals): void => {
		if (stopping) return;
		stopping = true;
		server.close().then(
			() => process.exit(0),
			(error: unknown) => {
				process.stderr.write(`mock-bank: error while stopping on ${signal}: ${String(error)}\n`);
				process.exit(1);
			},
		);
	};
	process.on('SIGTERM', stop);
	process.on('SIGINT', stop);
}

main().catch((error: unknown) => {
	const detail = error instanceof MockBankError ? `${error.code}: ${error.message}` : String(error);
	process.stderr.write(`mock-bank: failed to start: ${detail}\n`);
	process.exit(1);
});
