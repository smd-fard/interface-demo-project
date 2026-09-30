import { readFile } from 'node:fs/promises';
import { CapabilityArtifactSchema, type CapabilityArtifact } from '@idp/artifact-schema';
import { ArtifactFileError } from '../errors/ArtifactFileError.js';

/** An artifact file as read and as schema-parsed. */
export interface LoadedArtifact {
	/** The JSON document as read (the replay engine re-parses it and checks the content hash). */
	readonly document: unknown;
	readonly artifact: CapabilityArtifact;
}

/**
 * Reads an artifact file and validates it against the schema, before any browser starts. Errors name issue paths
 * and codes only. The content hash is not checked here: a mismatch is reported by the replay as a `failure`.
 */
export async function loadArtifactFile(file: string): Promise<LoadedArtifact> {
	let text: string;
	try {
		text = await readFile(file, 'utf8');
	} catch (error) {
		throw new ArtifactFileError('artifact_not_found', `artifact file ${file} cannot be read`, { cause: error });
	}
	let document: unknown;
	try {
		document = JSON.parse(text);
	} catch (error) {
		throw new ArtifactFileError('artifact_invalid', `artifact file ${file} is not valid JSON`, { cause: error });
	}
	const parsed = CapabilityArtifactSchema.safeParse(document);
	if (!parsed.success) {
		const issues = parsed.error.issues
			.slice(0, 5)
			.map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.code}`)
			.join('; ');
		throw new ArtifactFileError('artifact_invalid', `artifact file ${file} is not a capability artifact (${issues})`);
	}
	return { document, artifact: parsed.data };
}
