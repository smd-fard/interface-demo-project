import {
	ArtifactRefSchema,
	CapabilityArtifactSchema,
	EvidenceRefSchema,
	RunManifestSchema,
	RunResultSchema,
	type ArtifactRef,
	type CapabilityArtifact,
	type EvidenceRef,
	type RunManifest,
	type RunResult,
	type RunResultKind,
} from '@idp/artifact-schema';
import { REDACTION_RULES_VERSION, type Redacted } from '@idp/policy';
import { EvidenceValidationError } from '../errors/EvidenceValidationError.js';
import { parseOrThrow } from '../internal/parseOrThrow.js';
import { writeFileSafely } from '../internal/writeFileSafely.js';
import { RUN_FILES, type RunDirectory } from '../runs/RunDirectory.js';

/** Options for `RunManifestWriter`: the run start time, the artifact (if known) and the redaction-rules version. */
export interface RunManifestWriterOptions {
	readonly startedAt: Date;
	/** The artifact being replayed, if known up front. */
	readonly artifact?: ArtifactRef | null;
	/** Defaults to the `@idp/policy` REDACTION_RULES_VERSION. */
	readonly redactionRulesVersion?: string;
}

const json = (value: unknown) => `${JSON.stringify(value, null, '\t')}\n`;

/**
 * Accumulates a run's evidence refs and writes its documents: `manifest.json` (rewritten atomically, so it can
 * be written at start and again at the end), `result.json` and `artifact.json`. Every document is validated
 * against its contract before it is written; result and artifact must already be `Redacted` (invariant 3).
 */
export class RunManifestWriter {
	private readonly evidence = new Map<string, EvidenceRef>();
	private artifact: ArtifactRef | null;
	private resultKind: RunResultKind | null = null;
	private endedAt: Date | null = null;
	private readonly startedAt: Date;
	private readonly redactionRulesVersion: string;

	constructor(
		readonly runDir: RunDirectory,
		options: RunManifestWriterOptions,
	) {
		this.startedAt = new Date(options.startedAt.getTime());
		this.artifact = options.artifact ?? null;
		this.redactionRulesVersion = options.redactionRulesVersion ?? REDACTION_RULES_VERSION;
	}

	/** Records evidence refs for the manifest. Throws `EvidenceValidationError` on an invalid or duplicate ref. */
	addEvidence(...refs: readonly EvidenceRef[]): void {
		for (const candidate of refs) {
			const ref = parseOrThrow(EvidenceRefSchema, candidate, 'evidence ref');
			if (this.evidence.has(ref.id)) {
				throw new EvidenceValidationError('duplicate evidence ref', [
					{ path: ['id'], message: `"${ref.id}" is already recorded` },
				]);
			}
			this.evidence.set(ref.id, ref);
		}
	}

	/** Sets the artifact the run replayed or compiled. */
	setArtifact(ref: ArtifactRef): void {
		this.artifact = parseOrThrow(ArtifactRefSchema, ref, 'artifact ref');
	}

	/** Validates and writes `result.json`; the manifest's `resultKind` follows it. */
	async writeResult(result: Redacted<RunResult>): Promise<void> {
		const validated = parseOrThrow(RunResultSchema, result, 'run result');
		if (validated.runId !== this.runDir.runId) {
			throw new EvidenceValidationError('invalid run result', [
				{ path: ['runId'], message: `result belongs to ${validated.runId}, not ${this.runDir.runId}` },
			]);
		}
		await writeFileSafely(this.runDir.resultPath, json(validated), { exclusive: false });
		this.resultKind = validated.kind;
	}

	/** Validates and writes `artifact.json`, records it as the run's artifact and returns its ref. */
	async writeArtifact(artifact: Redacted<CapabilityArtifact>): Promise<ArtifactRef> {
		const validated = parseOrThrow(CapabilityArtifactSchema, artifact, 'capability artifact');
		await writeFileSafely(this.runDir.artifactPath, json(validated), { exclusive: false });
		const ref: ArtifactRef = { id: validated.id, version: validated.version, contentHash: validated.contentHash };
		this.artifact = ref;
		return ref;
	}

	/** The manifest as it would be written now. `endedAt` is null until a final `writeManifest({ endedAt })`. */
	snapshot(): RunManifest {
		return {
			runId: this.runDir.runId,
			kind: this.runDir.kind,
			startedAt: this.startedAt.toISOString(),
			endedAt: this.endedAt === null ? null : this.endedAt.toISOString(),
			artifact: this.artifact,
			resultKind: this.resultKind,
			evidence: [...this.evidence.values()],
			logPath: RUN_FILES.log,
			redactionRulesVersion: this.redactionRulesVersion,
		};
	}

	/**
	 * Validates and (re)writes `manifest.json`. Pass `endedAt` when the run ends. Throws
	 * `EvidenceValidationError` (e.g. endedAt before startedAt, a result without endedAt) or `EvidenceWriteError`.
	 */
	async writeManifest(options: { readonly endedAt?: Date } = {}): Promise<RunManifest> {
		const previous = this.endedAt;
		if (options.endedAt !== undefined) this.endedAt = new Date(options.endedAt.getTime());
		let manifest: RunManifest;
		try {
			manifest = parseOrThrow(RunManifestSchema, this.snapshot(), 'run manifest');
		} catch (error) {
			this.endedAt = previous;
			throw error;
		}
		await writeFileSafely(this.runDir.manifestPath, json(manifest), { exclusive: false });
		return manifest;
	}
}
