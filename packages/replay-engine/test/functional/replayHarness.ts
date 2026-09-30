import { readFile } from 'node:fs/promises';
import {
	AppProfileSchema,
	CapabilityArtifactSchema,
	computeContentHash,
	type AppProfile,
	type CapabilityArtifact,
	RunManifestSchema,
	type RunLogEntry,
	type RunManifest,
	type RunResult,
} from '@idp/artifact-schema';
import { RunLog } from '@idp/evidence';
import { createRedactor, resolvePolicy } from '@idp/policy';
import { ControlClient, openLiveSession, type LiveSession } from '@idp/session';
import { mockBankPolicyConfig, type MockBank } from '@idp/surface/testing';
import { expect } from 'vitest';
import { InMemoryCredentialProvider, replay, type ReplayOptionsInput } from '../../src/index.js';

/** Synthetic seed values (apps/mock-bank/src/data): none may reach run.jsonl or result.json. */
export const SECRETS = ['12345', 'Jane Sample', 'synthetic-pass-01', 'synthetic-pass-02', 'teller01', '1523.47'];

export type FixtureName = 'member-lookup' | 'open-sub-account';

export async function loadFixture(name: FixtureName): Promise<CapabilityArtifact> {
	const url = new URL(`../../../artifact-schema/fixtures/${name}.artifact.json`, import.meta.url);
	return CapabilityArtifactSchema.parse(JSON.parse(await readFile(url, 'utf8')));
}

/** The mock-bank app profile (tenant A): the default condition rules, resolved after the artifact's own. */
export async function loadProfile(): Promise<AppProfile> {
	const url = new URL('../../../../config/apps/mock-bank.profile.json', import.meta.url);
	return AppProfileSchema.parse(JSON.parse(await readFile(url, 'utf8')));
}

/** A test copy of an artifact with its contentHash recomputed (a hand edit must be re-hashed to replay). */
export async function rehashed(artifact: CapabilityArtifact): Promise<CapabilityArtifact> {
	return { ...artifact, contentHash: await computeContentHash(artifact) };
}

export interface Run {
	readonly result: RunResult;
	readonly entries: RunLogEntry[];
	readonly logText: string;
	readonly resultText: string;
	readonly session: LiveSession;
}

export interface StartOptions {
	readonly bank: MockBank;
	readonly root: string;
	readonly artifact: CapabilityArtifact;
	readonly params: Record<string, unknown>;
	readonly attended?: boolean;
	readonly profile?: AppProfile;
	readonly credential?: { readonly username: string; readonly password: string };
	readonly options?: ReplayOptionsInput;
}

export interface StartedRun {
	readonly session: LiveSession;
	/** The operator's control API client (attended only). */
	readonly client: ControlClient | null;
	/** Resolves when the replay has finished and the session is closed. */
	readonly done: Promise<Run>;
}

/**
 * Opens a live session against the mock-bank and starts a replay on it (not awaited), so an attended test can
 * act as the operator through the control API while the replay waits. `done` closes the session and reads back
 * run.jsonl and result.json.
 */
export async function startReplay(start: StartOptions): Promise<StartedRun> {
	const { bank, artifact } = start;
	const attended = start.attended ?? false;
	const policy = resolvePolicy(mockBankPolicyConfig(bank.origin));
	// The replay engine seeds this redactor (params, credentials, extracted outputs); the session's sinks use it.
	const redactor = createRedactor({ config: policy, sensitiveValues: [] });
	const session = await openLiveSession({
		policy,
		redactor,
		runsRoot: start.root,
		runKind: 'replay',
		origin: bank.origin,
		headless: true,
		attended,
		controlPort: 0,
		subject: { kind: 'capability', id: artifact.id, version: artifact.version },
	});
	const client = attended
		? new ControlClient({ url: session.controlUrl ?? '', token: session.controlToken ?? '' })
		: null;
	const done = (async (): Promise<Run> => {
		let result: RunResult;
		try {
			result = await replay({
				artifact,
				params: start.params,
				session,
				redactor,
				origin: bank.origin,
				...(start.profile === undefined ? {} : { profile: start.profile }),
				credentials: new InMemoryCredentialProvider({
					'mockbank-operator': start.credential ?? { username: 'teller01', password: 'synthetic-pass-01' },
				}),
				options: { attended, ...start.options },
			});
		} finally {
			await session.close();
		}
		return {
			result,
			entries: await RunLog.read(session.runLog.path),
			logText: await readFile(session.runLog.path, 'utf8'),
			resultText: await readFile(session.runDir.resultPath, 'utf8'),
			session,
		};
	})();
	// Keep an early rejection from surfacing as unhandled before the test awaits `done`.
	done.catch(() => undefined);
	return { session, client, done };
}

/** Replays to the end (unattended unless stated). */
export async function runReplay(start: StartOptions): Promise<Run> {
	return (await startReplay(start)).done;
}

/** Polls until `probe` returns a value (bounded). */
export async function until<T>(
	probe: () => Promise<T | undefined> | T | undefined,
	what: string,
	timeoutMs = 20_000,
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = await probe();
		if (value !== undefined) return value;
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

export function expectNoSecrets(
	{ logText, resultText }: Pick<Run, 'logText' | 'resultText'>,
	extra: string[] = [],
): void {
	for (const secret of [...SECRETS, ...extra]) {
		expect(logText, `run.jsonl leaks ${secret}`).not.toContain(secret);
		expect(resultText, `result.json leaks ${secret}`).not.toContain(secret);
	}
}

/** The lease states in order, starting from AGENT (the CLOSED transition from session.close() dropped). */
export function leasePath(session: LiveSession): string {
	const states = ['AGENT', ...session.lease.history().map((transition) => transition.to)];
	return states.filter((state) => state !== 'CLOSED').join(' → ');
}

/** A test copy of an artifact with one step changed (re-hashed so it replays). */
export async function withStep(
	artifact: CapabilityArtifact,
	stepId: string,
	patch: (step: CapabilityArtifact['steps'][number]) => CapabilityArtifact['steps'][number],
): Promise<CapabilityArtifact> {
	const steps = artifact.steps.map((step) => (step.id === stepId ? patch(step) : step));
	return rehashed({ ...artifact, steps });
}

/** The run's `recovery` entries, as plain objects (code, kind, attempt, budget, outcome, step). */
export function recoveriesOf(run: Pick<Run, 'entries'>) {
	return run.entries
		.filter((entry) => entry.kind === 'recovery')
		.map(({ code, recoveryKind, attempt, budget, outcome, stepId }) => ({
			code,
			recoveryKind,
			attempt,
			budget,
			outcome,
			stepId,
		}));
}

/** How many `action` entries a step has (each act, including a recovery's own action for that step). */
export function actionsAt(run: Pick<Run, 'entries'>, stepId: string, kind?: string): number {
	return run.entries.filter(
		(entry) => entry.kind === 'action' && entry.stepId === stepId && (kind === undefined || entry.actionKind === kind),
	).length;
}

/** The run's manifest.json, and whether every evidence file it lists exists. */
export async function readManifest(run: Pick<Run, 'session'>): Promise<RunManifest> {
	return RunManifestSchema.parse(JSON.parse(await readFile(run.session.runDir.manifestPath, 'utf8')));
}
