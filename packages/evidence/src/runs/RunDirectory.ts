import { mkdir, stat, writeFile } from 'node:fs/promises';
import nodePath from 'node:path';
import { RunIdSchema, RunRelativePathSchema, type RunId, type RunKind } from '@idp/artifact-schema';
import { EvidenceReadError } from '../errors/EvidenceReadError.js';
import { EvidenceWriteError } from '../errors/EvidenceWriteError.js';
import { parseOrThrow } from '../internal/parseOrThrow.js';

/** The conventional runs root, relative to the working directory (gitignored). Pass it as `root`. */
export const DEFAULT_RUNS_ROOT = '.runs';

/** The evidence subdirectories every run directory has. */
export const RUN_SUBDIRS = ['screenshots', 'snapshots', 'interventions', 'prompts'] as const;
/** One of the evidence subdirectories in `RUN_SUBDIRS`. */
export type RunSubdir = (typeof RUN_SUBDIRS)[number];

/** The fixed files of a run directory, relative to it. */
export const RUN_FILES = Object.freeze({
	log: 'run.jsonl',
	manifest: 'manifest.json',
	result: 'result.json',
	artifact: 'artifact.json',
});

/**
 * One run's evidence directory, `<root>/<runId>/`: `run.jsonl`, `manifest.json`, `result.json`,
 * `artifact.json` and the `screenshots/`, `snapshots/`, `interventions/`, `prompts/` subdirectories.
 */
export class RunDirectory {
	readonly kind: RunKind;
	readonly logPath: string;
	readonly manifestPath: string;
	readonly resultPath: string;
	readonly artifactPath: string;

	private constructor(
		readonly runId: RunId,
		/** Absolute path of the run directory. */
		readonly path: string,
	) {
		this.kind = runId.startsWith('discovery-') ? 'discovery' : 'replay';
		this.logPath = nodePath.join(this.path, RUN_FILES.log);
		this.manifestPath = nodePath.join(this.path, RUN_FILES.manifest);
		this.resultPath = nodePath.join(this.path, RUN_FILES.result);
		this.artifactPath = nodePath.join(this.path, RUN_FILES.artifact);
	}

	/**
	 * Creates `<root>/<runId>/` (and a missing root) with an empty `run.jsonl` and every subdirectory. Fails
	 * with `EvidenceWriteError` if the run directory already exists: a run never reuses another's evidence.
	 */
	static async create(root: string, runId: string): Promise<RunDirectory> {
		const id = parseOrThrow(RunIdSchema, runId, 'run id');
		const runDir = new RunDirectory(id, nodePath.resolve(root, id));
		try {
			await mkdir(nodePath.dirname(runDir.path), { recursive: true });
			await mkdir(runDir.path);
			await writeFile(runDir.logPath, '', { flag: 'wx' });
			for (const sub of RUN_SUBDIRS) await mkdir(nodePath.join(runDir.path, sub));
		} catch (cause) {
			throw new EvidenceWriteError(`cannot create run directory ${runDir.path}`, { cause });
		}
		return runDir;
	}

	/** Opens an existing run directory (e.g. for the CLI or to serve evidence). */
	static async open(root: string, runId: string): Promise<RunDirectory> {
		const id = parseOrThrow(RunIdSchema, runId, 'run id');
		const runDir = new RunDirectory(id, nodePath.resolve(root, id));
		try {
			const info = await stat(runDir.path);
			if (!info.isDirectory()) throw new Error(`${runDir.path} is not a directory`);
		} catch (cause) {
			throw new EvidenceReadError(`cannot open run directory ${runDir.path}`, { cause });
		}
		return runDir;
	}

	/**
	 * The absolute path of a run-relative path. Throws `EvidenceValidationError` for a path that could leave
	 * the run directory (leading "/", "." or ".." segments, backslashes).
	 */
	resolve(relative: string): string {
		return nodePath.join(this.path, ...parseOrThrow(RunRelativePathSchema, relative, 'run-relative path').split('/'));
	}
}
