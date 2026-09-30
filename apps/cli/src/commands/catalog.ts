// The `catalog` command. Deterministic, file-only: it never imports `@idp/agent` (nor a browser).
import path from 'node:path';
import type { Redacted } from '@idp/policy';
import { parseCommandArgs } from '../args/parseCommandArgs.js';
import type { CommandSpec } from '../args/CommandSpec.js';
import { readCatalog, type CatalogEntry, type CatalogIo } from '../catalog/readCatalog.js';
import { userPath, type CliContext } from '../cli/CliContext.js';
import { EXIT } from '../cli/exitCodes.js';
import { ArtifactFileError } from '../errors/ArtifactFileError.js';
import type { Printer } from '../output/Printer.js';

/** The `catalog` command: flags, usage, examples and exit codes (the source of `idp catalog --help`). */
export const spec = {
	name: 'catalog',
	summary: 'idp catalog — list the capability artifacts: id, version, summary, params, outputs, hash status.',
	usage: 'idp catalog [--dir <dir>] [--verify] [--json]',
	options: {
		dir: { type: 'string', valueName: 'dir', description: 'The catalog directory (default: <repo>/artifacts).' },
		verify: { type: 'boolean', description: 'Exit 1 when any artifact is invalid or its content hash does not match.' },
		json: { type: 'boolean', description: 'Print the catalog as JSON instead of text.' },
	},
	examples: ['pnpm idp catalog', 'pnpm idp catalog --verify', 'pnpm idp catalog --json'],
	notes: [
		'Hash status: verified (contentHash matches the content), mismatch (edited after hashing; replay refuses it), invalid (not a capability artifact).',
		'Exit codes: 0 listed (and, with --verify, all verified), 1 a mismatch or invalid artifact with --verify, or an error; 64 usage error.',
	],
} as const satisfies CommandSpec;

function io(items: readonly CatalogIo[]): string {
	if (items.length === 0) return '(none)';
	return items.map((item) => `${item.name}: ${item.type}${item.sensitive ? ', sensitive' : ''}`).join('; ');
}

function printEntry(printer: Printer, entry: CatalogEntry): void {
	if (entry.id === null) {
		printer.line(`${entry.file}  [${entry.status}]  not a capability artifact`);
		return;
	}
	printer.line(`${entry.id}@${entry.version ?? ''}  [${entry.status}]  ${entry.title ?? ''}  (${entry.file})`);
	if (entry.summary !== null) {
		printer.line(`  does:    ${entry.summary.does}`);
		printer.line(`  returns: ${entry.summary.returns}`);
	}
	printer.line(`  params:  ${io(entry.params)}`);
	printer.line(`  outputs: ${io(entry.outputs)}`);
}

/**
 * Runs `idp catalog`: lists `artifacts/*.json` with their hash status; returns 1 with `--verify` on any non-verified file.
 * @throws CliUsageError on bad flags; ArtifactFileError `artifact_not_found` when the catalog dir cannot be read.
 */
export async function run(args: readonly string[], context: CliContext): Promise<number> {
	const values = parseCommandArgs(spec, args);
	const dir = values.dir === undefined ? path.join(context.repoRoot, 'artifacts') : userPath(context, values.dir);
	let entries: CatalogEntry[];
	try {
		entries = await readCatalog(dir);
	} catch (error) {
		throw new ArtifactFileError('artifact_not_found', `the catalog directory ${dir} cannot be read`, { cause: error });
	}
	const { printer } = context;
	if (values.json === true) {
		// Free text (titles, summaries) goes through the redactor; ids, versions, types and hashes are structural.
		const redacted = entries.map((entry) => ({
			...entry,
			title: entry.title === null ? null : printer.redact(entry.title),
			summary: entry.summary === null ? null : printer.redactor.redact(entry.summary),
		}));
		const payload = { dir: printer.redact(dir), artifacts: redacted };
		printer.json(payload as Redacted<typeof payload>);
	} else {
		printer.line(`${entries.length} capability artifact(s) in ${dir}`);
		for (const entry of entries) {
			printer.line();
			printEntry(printer, entry);
		}
	}
	const bad = entries.filter((entry) => entry.status !== 'verified');
	if (values.verify === true && bad.length > 0) {
		printer.error(`catalog verify failed: ${bad.map((entry) => `${entry.file} (${entry.status})`).join(', ')}`);
		return EXIT.failure;
	}
	return EXIT.success;
}
