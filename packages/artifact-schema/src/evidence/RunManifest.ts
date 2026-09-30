import { z } from 'zod';
import { RunIdSchema, RunKindSchema } from '../common/Identifiers.js';
import { SemverSchema } from '../common/Semver.js';
import { ArtifactRefSchema } from '../result/ArtifactRef.js';
import { RunResultKindSchema } from '../result/RunResultKind.js';
import { EvidenceRefSchema, RunRelativePathSchema } from './EvidenceRef.js';

export const RunManifestSchema = z
	.strictObject({
		runId: RunIdSchema,
		kind: RunKindSchema,
		startedAt: z.iso.datetime().describe('When the run started (ISO 8601, UTC).'),
		endedAt: z.iso.datetime().nullable().describe('When the run ended; null while it is still running (or crashed).'),
		artifact: ArtifactRefSchema.nullable().describe(
			'The artifact replayed, or compiled by a discovery run; null when there is none (yet) or it was invalid.',
		),
		resultKind: RunResultKindSchema.nullable().describe(
			'The kind of the result in result.json; null until the run ends.',
		),
		evidence: z.array(EvidenceRefSchema).max(10_000).describe('Every evidence file of the run; ids are unique.'),
		logPath: RunRelativePathSchema.describe('Path of the run log inside the run directory, normally "run.jsonl".'),
		redactionRulesVersion: SemverSchema.describe(
			'Version of the redaction rules applied to every sink of this run, so a reviewer knows what was masked.',
		),
	})
	.superRefine((manifest, ctx) => {
		if (!manifest.runId.startsWith(`${manifest.kind}-`)) {
			ctx.addIssue({ code: 'custom', path: ['kind'], message: 'kind must match the runId prefix' });
		}
		if (manifest.endedAt !== null && Date.parse(manifest.endedAt) < Date.parse(manifest.startedAt)) {
			ctx.addIssue({ code: 'custom', path: ['endedAt'], message: 'endedAt is before startedAt' });
		}
		if (manifest.resultKind !== null && manifest.endedAt === null) {
			ctx.addIssue({ code: 'custom', path: ['resultKind'], message: 'a result requires endedAt' });
		}
		const ids = new Set<string>();
		manifest.evidence.forEach((ref, index) => {
			if (ids.has(ref.id))
				ctx.addIssue({ code: 'custom', path: ['evidence', index, 'id'], message: 'duplicate evidence id' });
			ids.add(ref.id);
		});
	})
	.describe('The index of one run directory (manifest.json): what ran, when, how it ended, and where its evidence is.');
export type RunManifest = z.infer<typeof RunManifestSchema>;
