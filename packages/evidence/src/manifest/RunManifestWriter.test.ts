import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	CapabilityArtifactSchema,
	RunManifestSchema,
	RunResultSchema,
	type CapabilityArtifact,
	type RunResult,
} from '@idp/artifact-schema';
import { REDACTION_RULES_VERSION, asMaskedScreenshot, type Redacted } from '@idp/policy';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tempRoot } from '../../test/fixtures/tempRoot.js';
import { RunDirectory } from '../runs/RunDirectory.js';
import { EvidenceStore } from '../store/EvidenceStore.js';
import { FakeClock } from '../testing/FakeClock.js';
import { RunManifestWriter } from './RunManifestWriter.js';

const RUN_ID = 'replay-20260929T101500-a1b2';
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../../../artifact-schema/fixtures/member-lookup.artifact.json');

// Test-only: the fixtures are already redacted (synthetic, parameter references only), so brand them directly.
const asRedacted = <T>(value: T) => value as Redacted<T>;

async function loadArtifact(): Promise<CapabilityArtifact> {
	return CapabilityArtifactSchema.parse(JSON.parse(await readFile(FIXTURE, 'utf8')));
}

describe('RunManifestWriter', () => {
	let root: string;
	let cleanup: () => Promise<void>;
	let runDir: RunDirectory;
	let clock: FakeClock;
	beforeEach(async () => {
		({ root, cleanup } = await tempRoot());
		runDir = await RunDirectory.create(root, RUN_ID);
		clock = new FakeClock(new Date('2026-09-29T10:15:00.000Z'));
	});
	afterEach(() => cleanup());

	it('writes a valid in-progress manifest, then a final one with the accumulated evidence', async () => {
		const writer = new RunManifestWriter(runDir, { startedAt: clock.now() });
		const store = new EvidenceStore(runDir, { onPut: (ref) => writer.addEvidence(ref) });
		await writer.writeManifest();
		let manifest = RunManifestSchema.parse(JSON.parse(await readFile(runDir.manifestPath, 'utf8')));
		expect(manifest).toEqual({
			runId: RUN_ID,
			kind: 'replay',
			startedAt: '2026-09-29T10:15:00.000Z',
			endedAt: null,
			artifact: null,
			resultKind: null,
			evidence: [],
			logPath: 'run.jsonl',
			redactionRulesVersion: REDACTION_RULES_VERSION,
		});

		const shot = await store.putScreenshot(asMaskedScreenshot(new Uint8Array([1, 2, 3])));
		const artifact = await loadArtifact();
		const artifactRef = { id: artifact.id, version: artifact.version, contentHash: artifact.contentHash };
		writer.setArtifact(artifactRef);
		const result: RunResult = {
			kind: 'business_outcome',
			runId: RUN_ID,
			artifact: artifactRef,
			code: 'member_not_found',
			message: 'No records match your search criteria',
			stepId: 's06-click-search',
		};
		await writer.writeResult(asRedacted(result));
		clock.advance(4_000);
		await writer.writeManifest({ endedAt: clock.now() });

		manifest = RunManifestSchema.parse(JSON.parse(await readFile(runDir.manifestPath, 'utf8')));
		expect(manifest).toMatchObject({
			endedAt: '2026-09-29T10:15:04.000Z',
			artifact: artifactRef,
			resultKind: 'business_outcome',
			evidence: [shot],
		});
		expect(RunResultSchema.parse(JSON.parse(await readFile(runDir.resultPath, 'utf8')))).toEqual(result);
	});

	it('writes artifact.json and returns its ref', async () => {
		const writer = new RunManifestWriter(runDir, { startedAt: clock.now() });
		const artifact = await loadArtifact();
		const ref = await writer.writeArtifact(asRedacted(artifact));
		expect(ref).toEqual({ id: artifact.id, version: artifact.version, contentHash: artifact.contentHash });
		expect(JSON.parse(await readFile(runDir.artifactPath, 'utf8'))).toEqual(artifact);
		expect(writer.snapshot().artifact).toEqual(ref);
	});

	it('rejects an invalid result, artifact or manifest with EVIDENCE_INVALID', async () => {
		const writer = new RunManifestWriter(runDir, { startedAt: clock.now() });
		await expect(writer.writeResult(asRedacted({ kind: 'nope' } as unknown as RunResult))).rejects.toMatchObject({
			code: 'EVIDENCE_INVALID',
		});
		await expect(
			writer.writeArtifact(asRedacted({ id: 'x' } as unknown as CapabilityArtifact)),
		).rejects.toMatchObject({ code: 'EVIDENCE_INVALID' });
		await expect(writer.writeManifest({ endedAt: new Date('2020-01-01T00:00:00Z') })).rejects.toMatchObject({
			code: 'EVIDENCE_INVALID',
		});
	});

	it('refuses duplicate evidence ids', () => {
		const writer = new RunManifestWriter(runDir, { startedAt: clock.now() });
		const ref = {
			id: 'screenshot-0001',
			kind: 'screenshot' as const,
			path: 'screenshots/0001.png',
			sha256: 'a'.repeat(64),
			redacted: true as const,
			localOnly: false,
		};
		writer.addEvidence(ref);
		expect(() => writer.addEvidence(ref)).toThrow(expect.objectContaining({ code: 'EVIDENCE_INVALID' }));
	});
});
