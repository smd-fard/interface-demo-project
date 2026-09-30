import { readFile } from 'node:fs/promises';
import { RunLogEntrySchema, type RunId, type RunLogEntry, type RunLogEntryInput } from '@idp/artifact-schema';
import type { Redacted, Redactor } from '@idp/policy';
import pino from 'pino';
import { EvidenceReadError } from '../errors/EvidenceReadError.js';
import { EvidenceValidationError } from '../errors/EvidenceValidationError.js';
import { EvidenceWriteError } from '../errors/EvidenceWriteError.js';
import { parseOrThrow } from '../internal/parseOrThrow.js';
import type { RunDirectory } from '../runs/RunDirectory.js';
import { redactRunLogEntry } from './redactRunLogEntry.js';

type Destination = ReturnType<typeof pino.destination>;

/**
 * The run log (`run.jsonl`): one schema-valid `RunLogEntry` JSON object per line, written synchronously
 * through a pino (sonic-boom) file destination. The only public write path, `log`, redacts first
 * (invariant 3); `seq` is assigned here, gap-free from 1.
 */
export class RunLog {
	private seq = 0;
	private closed = false;
	private failure: Error | undefined;

	private constructor(
		private readonly destination: Destination,
		private readonly redactor: Redactor,
		readonly runId: RunId,
		/** Absolute path of `run.jsonl`. */
		readonly path: string,
	) {
		destination.on('error', (error: Error) => {
			this.failure ??= error;
		});
	}

	/** Opens the run log of `runDir` for appending. Every entry written through it is redacted by `redactor`. */
	static create(runDir: RunDirectory, redactor: Redactor): RunLog {
		let destination: Destination;
		try {
			destination = pino.destination({ dest: runDir.logPath, sync: true, append: true });
		} catch (cause) {
			throw new EvidenceWriteError(`cannot open run log ${runDir.logPath}`, { cause });
		}
		return new RunLog(destination, redactor, runDir.runId, runDir.logPath);
	}

	/** Reads and validates every entry of a `run.jsonl`. Throws `EvidenceValidationError` on a bad line. */
	static async read(logPath: string): Promise<RunLogEntry[]> {
		let text: string;
		try {
			text = await readFile(logPath, 'utf8');
		} catch (cause) {
			throw new EvidenceReadError(`cannot read run log ${logPath}`, { cause });
		}
		return text
			.split('\n')
			.filter((line) => line.length > 0)
			.map((line, index) => {
				let json: unknown;
				try {
					json = JSON.parse(line);
				} catch (cause) {
					throw new EvidenceValidationError(`run log line ${index + 1} is not JSON`, [], { cause });
				}
				return parseOrThrow(RunLogEntrySchema, json, `run log line ${index + 1}`);
			});
	}

	/** The number of entries written so far (the last assigned `seq`). */
	get size(): number {
		return this.seq;
	}

	/**
	 * Redacts `entry`, assigns the next `seq`, validates it with `RunLogEntrySchema` and writes it as one line.
	 * Returns the entry exactly as written. Throws `EvidenceValidationError` (nothing written, no seq consumed)
	 * or `EvidenceWriteError`.
	 */
	log(entry: RunLogEntryInput): RunLogEntry {
		return this.append(redactRunLogEntry(entry, this.redactor));
	}

	/** Reads back this log's entries (flushes first). */
	async entries(): Promise<RunLogEntry[]> {
		if (!this.closed) this.flush();
		return RunLog.read(this.path);
	}

	/** Flushes and closes the file. Idempotent. */
	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.flush();
		await new Promise<void>((resolve, reject) => {
			this.destination.once('close', () => resolve());
			this.destination.once('error', reject);
			this.destination.end();
		}).catch((cause: unknown) => {
			throw new EvidenceWriteError(`cannot close run log ${this.path}`, { cause });
		});
	}

	// Private on purpose: only a Redacted entry reaches the file, and only `log` produces one here.
	private append(entry: Redacted<RunLogEntryInput>): RunLogEntry {
		if (this.closed) throw new EvidenceWriteError(`run log ${this.path} is closed`);
		if (this.failure !== undefined) {
			throw new EvidenceWriteError(`run log ${this.path} failed earlier`, { cause: this.failure });
		}
		const validated = parseOrThrow(RunLogEntrySchema, { ...entry, seq: this.seq + 1 }, 'run log entry');
		if (validated.runId !== this.runId) {
			throw new EvidenceValidationError('invalid run log entry', [
				{ path: ['runId'], message: `entry belongs to ${validated.runId}, not ${this.runId}` },
			]);
		}
		try {
			this.destination.write(`${JSON.stringify(validated)}\n`);
		} catch (cause) {
			throw new EvidenceWriteError(`cannot write to run log ${this.path}`, { cause });
		}
		this.seq = validated.seq;
		return validated;
	}

	private flush(): void {
		try {
			this.destination.flushSync();
		} catch (cause) {
			throw new EvidenceWriteError(`cannot flush run log ${this.path}`, { cause });
		}
	}
}
