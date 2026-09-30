import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CapabilityArtifactSchema, type CapabilityArtifact } from '@idp/artifact-schema';
import { EvidenceStore, newRunId, RunDirectory, RunLog, RunManifestWriter } from '@idp/evidence';
import { FakeClock, FakeRandom } from '@idp/evidence/testing';
import { createRedactor, type Redactor } from '@idp/policy';
import { FakeSurface, fakeLocation, type FakeSurfaceOptions } from '@idp/surface/testing';
import type { ReplaySession } from './ReplaySession.js';

export const ORIGIN = 'http://127.0.0.1:4010';

/** A fixture artifact from `@idp/artifact-schema/fixtures`, parsed. */
export function loadFixture(name: 'member-lookup' | 'open-sub-account'): CapabilityArtifact {
	const url = new URL(`../../artifact-schema/fixtures/${name}.artifact.json`, import.meta.url);
	return CapabilityArtifactSchema.parse(JSON.parse(readFileSync(url, 'utf8')));
}

/** The fixture JSON as written (not parsed), for tamper tests. */
export function loadFixtureJson(name: 'member-lookup' | 'open-sub-account'): Record<string, unknown> {
	const url = new URL(`../../artifact-schema/fixtures/${name}.artifact.json`, import.meta.url);
	return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>;
}

export interface FakeReplaySessionFixture {
	readonly session: ReplaySession;
	readonly surface: FakeSurface;
	readonly runDir: RunDirectory;
	readonly runLog: RunLog;
	readonly evidence: EvidenceStore;
	readonly manifest: RunManifestWriter;
	readonly redactor: Redactor;
	readonly clock: FakeClock;
	/** Surface calls other than `act`, in order (observe, check, captureEvidence, resolve, describe). */
	readonly calls: string[];
	cleanup(): Promise<void>;
}

/**
 * A replay session for unit tests: a scripted FakeSurface plus a real run directory, run log, evidence store
 * and manifest in a temp dir (so every written entry is schema-validated). No browser, no process.
 */
export async function fakeReplaySession(
	surfaceOptions: Partial<FakeSurfaceOptions> = {},
): Promise<FakeReplaySessionFixture> {
	const root = await mkdtemp(path.join(tmpdir(), 'idp-replay-unit-'));
	const clock = new FakeClock();
	const runDir = await RunDirectory.create(root, newRunId('replay', clock, new FakeRandom()));
	const redactor = createRedactor({ sensitiveValues: [] });
	const runLog = RunLog.create(runDir, redactor);
	const manifest = new RunManifestWriter(runDir, { startedAt: clock.now() });
	const evidence = new EvidenceStore(runDir, { onPut: (ref) => manifest.addEvidence(ref) });
	const surface = new FakeSurface({ location: fakeLocation(ORIGIN, '/login'), ...surfaceOptions });
	const calls: string[] = [];
	for (const method of ['observe', 'check', 'captureEvidence', 'resolve', 'describe'] as const) {
		const original = surface[method].bind(surface) as (...args: unknown[]) => Promise<unknown>;
		(surface as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
			calls.push(method);
			return original(...args);
		};
	}
	const session: ReplaySession = {
		runId: runDir.runId,
		surface,
		runLog,
		evidence,
		manifest,
		lease: { state: () => 'AGENT', reacquire: async () => 'AGENT' },
		requestApproval: () => Promise.reject(new Error('requestApproval is not scripted in this test')),
		escalate: () => Promise.reject(new Error('escalate is not scripted in this test')),
	};
	return {
		session,
		surface,
		runDir,
		runLog,
		evidence,
		manifest,
		redactor,
		clock,
		calls,
		cleanup: async () => {
			await runLog.close();
			await rm(root, { recursive: true, force: true });
		},
	};
}
