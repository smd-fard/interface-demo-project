import { constants } from 'node:fs';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { EvidenceRefSchema, type EvidenceKind, type EvidenceRef } from '@idp/artifact-schema';
import type { MaskedScreenshot, Redacted } from '@idp/policy';
import { EvidenceValidationError } from '../errors/EvidenceValidationError.js';
import { EvidenceWriteError } from '../errors/EvidenceWriteError.js';
import { parseOrThrow } from '../internal/parseOrThrow.js';
import { sha256 } from '../internal/sha256.js';
import { writeFileSafely } from '../internal/writeFileSafely.js';
import { RUN_FILES, type RunDirectory } from '../runs/RunDirectory.js';

/** Subdirectories a JSON document may be stored in (omitted = the run directory itself). */
export type JsonEvidenceSubdir = 'interventions' | 'prompts';

/** Options for `EvidenceStore`: a hook called with every stored ref (typically feeding the manifest). */
export interface EvidenceStoreOptions {
	/** Called with every stored ref, e.g. `(ref) => manifest.addEvidence(ref)`. */
	readonly onPut?: (ref: EvidenceRef) => void;
}

/** A stored evidence file: its ref and where it is on disk. */
export interface StoredEvidence {
	readonly ref: EvidenceRef;
	/** Absolute path of the stored file. */
	readonly absolutePath: string;
}

const NAME = /^[a-z0-9][a-z0-9_-]{0,79}$/i;
const LABEL = /^[a-z0-9][a-z0-9-]{0,59}$/;
const TRACES_DIR = 'traces';
const RESERVED = new Set(Object.values(RUN_FILES).map((file) => file.replace(/\.[^.]+$/, '')));
const ID_PREFIX: Record<EvidenceKind, string> = {
	screenshot: 'screenshot',
	a11y_snapshot: 'a11y-snapshot',
	trace: 'trace',
	json: 'json',
	log: 'log',
};

const counterOf = (n: number) => String(n).padStart(4, '0');

/**
 * Stores a run's evidence files and returns `EvidenceRef`s (sequential kebab ids, sha256 of the stored
 * bytes). It accepts only masked screenshots and `Redacted` documents (invariant 3); traces are stored
 * `localOnly` and never leave the machine. Files are never overwritten.
 */
export class EvidenceStore {
	private readonly refs = new Map<string, EvidenceRef>();
	private readonly counters = new Map<EvidenceKind, number>();

	constructor(
		readonly runDir: RunDirectory,
		private readonly options: EvidenceStoreOptions = {},
	) {}

	/** Stores masked screenshot bytes as `screenshots/<nnnn>[-<label>].png`. */
	async putScreenshot(bytes: MaskedScreenshot, options: { readonly label?: string } = {}): Promise<EvidenceRef> {
		const label = options.label;
		if (label !== undefined && !LABEL.test(label)) {
			throw new EvidenceValidationError('invalid screenshot label', [
				{ path: ['label'], message: 'lowercase kebab-case, at most 60 characters' },
			]);
		}
		return this.store('screenshot', (n) => `screenshots/${n}${label === undefined ? '' : `-${label}`}.png`, bytes);
	}

	/** Stores a redacted accessibility snapshot as `snapshots/<nnnn>.json`. */
	async putA11ySnapshot(tree: Redacted<unknown>): Promise<EvidenceRef> {
		return this.store('a11y_snapshot', (n) => `snapshots/${n}.json`, toJson(tree));
	}

	/**
	 * Stores a redacted JSON document as `[<subdir>/]<name>.json`, e.g. `interventions/ir-…json` or
	 * `prompts/turn-01.json`. The names of the fixed run files (manifest, result, artifact) are refused.
	 */
	async putJson(name: string, document: Redacted<unknown>, subdir?: JsonEvidenceSubdir): Promise<EvidenceRef> {
		if (!NAME.test(name) || (subdir === undefined && RESERVED.has(name))) {
			throw new EvidenceValidationError('invalid evidence name', [
				{ path: ['name'], message: `"${name}" must be a safe file name and not a reserved run file` },
			]);
		}
		return this.store('json', () => `${subdir === undefined ? '' : `${subdir}/`}${name}.json`, toJson(document));
	}

	/**
	 * Copies a local-only file (a Playwright trace) to `traces/<nnnn>-<basename>` and returns a `localOnly`
	 * ref. Such files may hold unmasked content, so evidence export never copies them.
	 */
	async putLocalOnly(sourcePath: string): Promise<EvidenceRef> {
		const base = path.basename(sourcePath).replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[._-]+/, '') || 'file';
		const counter = this.next('trace');
		const relative = `${TRACES_DIR}/${counterOf(counter)}-${base}`;
		const target = this.runDir.resolve(relative);
		let bytes: Buffer;
		try {
			await mkdir(path.dirname(target), { recursive: true });
			await copyFile(sourcePath, target, constants.COPYFILE_EXCL);
			bytes = await readFile(target);
		} catch (cause) {
			throw new EvidenceWriteError(`cannot store local-only file ${sourcePath}`, { cause });
		}
		return this.register('trace', counter, relative, bytes, true);
	}

	/** The ref and absolute path of a stored evidence file, or undefined if the id is unknown. */
	get(refId: string): StoredEvidence | undefined {
		const ref = this.refs.get(refId);
		return ref === undefined ? undefined : { ref, absolutePath: this.runDir.resolve(ref.path) };
	}

	/** Every stored ref, in storage order. */
	list(): readonly EvidenceRef[] {
		return [...this.refs.values()];
	}

	private next(kind: EvidenceKind): number {
		const counter = (this.counters.get(kind) ?? 0) + 1;
		this.counters.set(kind, counter);
		return counter;
	}

	private async store(
		kind: EvidenceKind,
		pathFor: (counter: string) => string,
		data: Uint8Array | string,
	): Promise<EvidenceRef> {
		const counter = this.next(kind);
		const relative = pathFor(counterOf(counter));
		const target = this.runDir.resolve(relative);
		try {
			await mkdir(path.dirname(target), { recursive: true });
		} catch (cause) {
			throw new EvidenceWriteError(`cannot create ${path.dirname(target)}`, { cause });
		}
		await writeFileSafely(target, data, { exclusive: true });
		return this.register(kind, counter, relative, data, false);
	}

	private register(
		kind: EvidenceKind,
		counter: number,
		relative: string,
		data: Uint8Array | string,
		localOnly: boolean,
	): EvidenceRef {
		const ref = parseOrThrow(
			EvidenceRefSchema,
			{
				id: `${ID_PREFIX[kind]}-${counterOf(counter)}`,
				kind,
				path: relative,
				sha256: sha256(data),
				redacted: true,
				localOnly,
			},
			'evidence ref',
		);
		this.refs.set(ref.id, ref);
		this.options.onPut?.(ref);
		return ref;
	}
}

function toJson(document: unknown): string {
	let json: string | undefined;
	try {
		json = JSON.stringify(document, null, '\t') as string | undefined;
	} catch (cause) {
		throw new EvidenceValidationError('evidence document is not serializable as JSON', [], { cause });
	}
	if (json === undefined) throw new EvidenceValidationError('evidence document is not serializable as JSON');
	return `${json}\n`;
}
