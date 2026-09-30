import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
	CapabilityArtifactSchema,
	computeContentHash,
	type CapabilityArtifact,
	type ValueType,
} from '@idp/artifact-schema';

/** How an artifact file checks out: its hash verifies, its content changed after hashing, or it is not valid. */
export type HashStatus = 'verified' | 'mismatch' | 'invalid';

/** A param or output as the catalog lists it (type rendered as text). */
export interface CatalogIo {
	readonly name: string;
	readonly type: string;
	readonly sensitive: boolean;
	readonly required?: boolean;
}

/** One artifact file in the catalog, with its hash status; the artifact fields are null when it is invalid. */
export interface CatalogEntry {
	/** The file name within the catalog dir. */
	readonly file: string;
	readonly status: HashStatus;
	/** Null when the file is not a valid artifact. */
	readonly id: string | null;
	readonly version: string | null;
	readonly title: string | null;
	readonly summary: CapabilityArtifact['summary'] | null;
	readonly params: readonly CatalogIo[];
	readonly outputs: readonly CatalogIo[];
	readonly contentHash: string | null;
}

function describeType(type: ValueType): string {
	switch (type.kind) {
		case 'decimal':
			return `decimal(${type.scale})`;
		case 'enum':
			return `enum(${type.values.join('|')})`;
		default:
			return type.kind;
	}
}

async function entryFor(dir: string, file: string): Promise<CatalogEntry> {
	const empty = {
		file,
		id: null,
		version: null,
		title: null,
		summary: null,
		params: [],
		outputs: [],
		contentHash: null,
	};
	let document: unknown;
	try {
		document = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
	} catch (error) {
		if (error instanceof SyntaxError) return { ...empty, status: 'invalid' };
		throw error;
	}
	const parsed = CapabilityArtifactSchema.safeParse(document);
	if (!parsed.success) return { ...empty, status: 'invalid' };
	const artifact = parsed.data;
	return {
		file,
		status: (await computeContentHash(artifact)) === artifact.contentHash ? 'verified' : 'mismatch',
		id: artifact.id,
		version: artifact.version,
		title: artifact.title,
		summary: artifact.summary,
		params: artifact.params.map((param) => ({
			name: param.name,
			type: describeType(param.type),
			sensitive: param.sensitive,
			required: param.required,
		})),
		outputs: artifact.outputs.map((output) => ({
			name: output.name,
			type: describeType(output.type),
			sensitive: output.sensitive,
		})),
		contentHash: artifact.contentHash,
	};
}

/** Reads every `*.json` of the catalog dir (sorted by file name) and checks each artifact's content hash. */
export async function readCatalog(dir: string): Promise<CatalogEntry[]> {
	const files = (await readdir(dir, { withFileTypes: true }))
		.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
		.map((entry) => entry.name)
		.sort();
	return Promise.all(files.map((file) => entryFor(dir, file)));
}
