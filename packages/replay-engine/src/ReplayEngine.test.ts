import { readFile } from 'node:fs/promises';
import { computeContentHash, RunResultSchema, type CapabilityArtifact } from '@idp/artifact-schema';
import { RunLog } from '@idp/evidence';
import type { ActOutcome, SurfaceAction } from '@idp/surface';
import { afterEach, describe, expect, it } from 'vitest';
import {
	fakeReplaySession,
	loadFixture,
	loadFixtureJson,
	ORIGIN,
	type FakeReplaySessionFixture,
} from './fakeReplaySession.test-helper.js';
import { InMemoryCredentialProvider } from './params/InMemoryCredentialProvider.js';
import { replay } from './ReplayEngine.js';

const credentials = () =>
	new InMemoryCredentialProvider({ 'mockbank-operator': { username: 'teller01', password: 'synthetic-pass-01' } });

/** Scripted landing: extract steps read the seeded member; s05 resolves on a fallback rung (drift). */
function memberLookupOnAct(action: SurfaceAction): ActOutcome | undefined {
	const base = { kind: action.kind, url: `${ORIGIN}/`, navigation: null };
	if (action.kind === 'extract') {
		const extracted = action.stepId === 's07-extract-savings-balance' ? '1,523.47' : 'Jane Sample';
		return { ...base, extracted, resolution: { rungIndex: 0, rungKind: 'structural' } };
	}
	if (action.stepId === 's05-fill-member-id') return { ...base, resolution: { rungIndex: 1, rungKind: 'structural' } };
	if ('target' in action && action.target !== undefined)
		return { ...base, resolution: { rungIndex: 0, rungKind: 'role' } };
	return base;
}

describe('replay (unit, fake session)', () => {
	let fixture: FakeReplaySessionFixture;
	afterEach(async () => {
		await fixture.cleanup();
	});

	async function run(artifact: unknown, params: Record<string, unknown>) {
		return replay({
			artifact,
			params,
			session: fixture.session,
			redactor: fixture.redactor,
			origin: ORIGIN,
			credentials: credentials(),
			clock: fixture.clock,
		});
	}

	it('invalid params fail with invalid_params before any surface call (AC8)', async () => {
		fixture = await fakeReplaySession();
		const result = await run(loadFixture('member-lookup'), { memberId: 'abc' });
		expect(RunResultSchema.parse(result)).toMatchObject({
			kind: 'failure',
			reason: 'invalid_params',
			step: null,
			evidence: [],
			artifact: { id: 'member-lookup', version: '1.0.1' },
		});
		expect(fixture.surface.acts).toEqual([]);
		expect(fixture.calls).toEqual([]);
		const entries = await fixture.runLog.entries();
		expect(entries.map((entry) => entry.kind)).toEqual(['run_started', 'result']);
		expect(JSON.parse(await readFile(fixture.runDir.resultPath, 'utf8'))).toMatchObject({ reason: 'invalid_params' });
	});

	it('a missing required param and an unknown param are invalid_params too', async () => {
		fixture = await fakeReplaySession();
		expect(await run(loadFixture('member-lookup'), {})).toMatchObject({ kind: 'failure', reason: 'invalid_params' });
		expect(fixture.surface.acts).toEqual([]);
	});

	it('a contentHash mismatch fails with artifact_invalid and artifact null, before any surface call', async () => {
		fixture = await fakeReplaySession();
		const tampered = loadFixtureJson('member-lookup');
		tampered['title'] = 'Member lookup (edited)';
		const result = await run(tampered, { memberId: '12345' });
		expect(RunResultSchema.parse(result)).toMatchObject({
			kind: 'failure',
			reason: 'artifact_invalid',
			artifact: null,
			step: null,
		});
		expect(fixture.surface.acts).toEqual([]);
		expect(fixture.calls).toEqual([]);
	});

	it('a schema-invalid artifact fails with artifact_invalid', async () => {
		fixture = await fakeReplaySession();
		const result = await run({ id: 'member-lookup' }, { memberId: '12345' });
		expect(result).toMatchObject({ kind: 'failure', reason: 'artifact_invalid', artifact: null });
		expect(fixture.surface.acts).toEqual([]);
	});

	it('success: runs every step through the surface as replay, extracts typed outputs and records drift', async () => {
		fixture = await fakeReplaySession({ onAct: memberLookupOnAct });
		const artifact = loadFixture('member-lookup');
		const result = await run(artifact, { memberId: '12345' });
		expect(RunResultSchema.parse(result)).toEqual({
			kind: 'success',
			runId: fixture.session.runId,
			artifact: { id: artifact.id, version: artifact.version, contentHash: artifact.contentHash },
			outputs: { savingsBalance: '1523.47', memberName: 'Jane Sample' },
			durationMs: 0,
			drift: [{ stepId: 's05-fill-member-id', rungIndex: 1, rungKind: 'structural' }],
			recoveries: 0,
		});
		expect(
			fixture.surface.acts.map((action) => [action.kind, action.actor, action.stepId, action.declaredRisk]),
		).toEqual(artifact.steps.map((step) => [step.kind, 'replay', step.id, step.risk]));
		const password = fixture.surface.acts[2];
		expect(password).toMatchObject({ kind: 'fill', value: 'synthetic-pass-01', sensitive: true });
		expect(fixture.surface.acts[4]).toMatchObject({ kind: 'fill', value: '12345', bindings: { memberId: '12345' } });

		const log = await readFile(fixture.runLog.path, 'utf8');
		const persisted = await readFile(fixture.runDir.resultPath, 'utf8');
		for (const secret of ['12345', 'Jane Sample', 'synthetic-pass-01', 'teller01', '1523.47']) {
			expect(log).not.toContain(secret);
			expect(persisted).not.toContain(secret);
		}
		const entries = await RunLog.read(fixture.runLog.path);
		expect(entries[0]).toMatchObject({ kind: 'run_started', runKind: 'replay', origin: ORIGIN, goal: null });
		expect(entries.at(-1)).toMatchObject({ kind: 'result', resultKind: 'success' });
		expect(entries.filter((entry) => entry.kind === 'action')).toHaveLength(artifact.steps.length);
		const manifest = JSON.parse(await readFile(fixture.runDir.manifestPath, 'utf8')) as Record<string, unknown>;
		expect(manifest).toMatchObject({ resultKind: 'success', artifact: { id: 'member-lookup' } });
	});

	it('the success condition not holding is checkpoint_failed outside any step', async () => {
		const artifact = loadFixture('member-lookup');
		// Every step checkpoint holds (3 of them, each also read once before its step: the retry's pre-step state),
		// then the success condition does not.
		const held = { kind: 'held' } as const;
		fixture = await fakeReplaySession({
			onAct: memberLookupOnAct,
			checks: [held, held, held, held, held, held, { kind: 'not_held', observed: 'text "Member Inquiry" not present' }],
		});
		const result = await run(artifact, { memberId: '12345' });
		expect(result).toMatchObject({ kind: 'failure', reason: 'checkpoint_failed', step: null });
		if (result.kind !== 'failure') throw new Error('unreachable');
		expect(result.evidence).toHaveLength(2);
	});

	it('an output that fails its type is output_invalid', async () => {
		fixture = await fakeReplaySession({
			onAct: (action) =>
				action.kind === 'extract' && action.stepId === 's07-extract-savings-balance'
					? { kind: 'extract', url: `${ORIGIN}/`, navigation: null, extracted: '1.234' }
					: memberLookupOnAct(action),
		});
		const result = await run(loadFixture('member-lookup'), { memberId: '12345' });
		expect(result).toMatchObject({
			kind: 'failure',
			reason: 'output_invalid',
			step: { index: 6, id: 's07-extract-savings-balance' },
		});
	});

	it('an artifact with a recomputed hash replays (the hash covers the document, not the file)', async () => {
		fixture = await fakeReplaySession({ onAct: memberLookupOnAct });
		const artifact = loadFixture('member-lookup');
		const edited: CapabilityArtifact = { ...artifact, title: 'Member lookup (v2)' };
		const rehashed = { ...edited, contentHash: await computeContentHash(edited) };
		expect(await run(rehashed, { memberId: '12345' })).toMatchObject({ kind: 'success' });
	});
});
