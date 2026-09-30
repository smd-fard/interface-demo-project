import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { RecoverySchema } from '../outcome/Recovery.js';
import { RUN_LOG_ENTRY_KINDS, RunLogEntrySchema, type RunLogEntry, type RunLogEntryInput } from './RunLogEntry.js';

const REPLAY = 'replay-20260929T101500-a1b2';
const DISCOVERY = 'discovery-20260929T085900-c0de';
const at = '2026-09-29T10:15:01.000Z';
const replay = { runId: REPLAY, actor: 'replay', at };
const discovery = { runId: DISCOVERY, actor: 'agent', at };
const ref = {
	id: 'a11y-0003',
	kind: 'a11y_snapshot',
	path: 'snapshots/0003.json',
	sha256: 'd'.repeat(64),
	redacted: true,
	localOnly: false,
};
const artifact = { id: 'member-lookup', version: '1.0.0', contentHash: `sha256:${'0'.repeat(64)}` };

const entries = [
	{ ...replay, kind: 'run_started', runKind: 'replay', artifact, goal: null, origin: 'http://127.0.0.1:4010' },
	{
		...discovery,
		kind: 'run_started',
		runKind: 'discovery',
		artifact: null,
		goal: 'Look up member {{memberId}}',
		origin: 'http://127.0.0.1:4010',
	},
	{
		...discovery,
		kind: 'observation',
		url: 'http://127.0.0.1:4010/',
		title: 'CoreOne - Sign On',
		digest: 'frames: banner, nav, content; heading "Sign On"',
		snapshotRef: ref,
		screenshotRef: null,
	},
	{
		...discovery,
		kind: 'decision',
		reason: 'The Sign On form is visible; fill the user id.',
		tool: 'fill',
		input: { target: 'User ID input', value: '{{credential:mockbank-operator.username}}' },
	},
	{
		...replay,
		kind: 'policy_verdict',
		verdict: 'deny',
		code: 'route_not_allowed',
		risk: 'read',
		actionKind: 'navigate',
		stepId: 's01-open-app',
	},
	{ ...replay, kind: 'locator_resolved', stepId: 's06-click-search', rungIndex: 1, rungKind: 'text' },
	{
		...replay,
		kind: 'action',
		actionKind: 'click',
		risk: 'read',
		stepId: 's06-click-search',
		target: 'Search button in the member search form',
		durationMs: 120,
	},
	{
		...replay,
		kind: 'checkpoint',
		stepId: 's06-click-search',
		checkpointKind: 'text_present',
		result: 'held',
	},
	{ ...replay, kind: 'checkpoint', stepId: null, checkpointKind: 'all_of', result: 'failed', detail: 'text absent' },
	{
		...replay,
		kind: 'condition_detected',
		code: 'session_timeout',
		class: 'recoverable',
		stepId: 's06-click-search',
	},
	{
		...replay,
		kind: 'recovery',
		code: 'session_timeout',
		recoveryKind: 'reauth',
		attempt: 1,
		budget: 1,
		outcome: 'succeeded',
		stepId: 's06-click-search',
	},
	{
		...replay,
		kind: 'lease_change',
		transition: { from: 'AGENT', to: 'PAUSED', actor: 'replay', reason: 'approval_required', at },
	},
	{
		...replay,
		kind: 'intervention',
		requestId: 'ir-20260929T101530-beef',
		interventionKind: 'approval',
		event: 'resolved',
		decision: 'approve',
		requestRef: { ...ref, id: 'intervention-0001', kind: 'json', path: 'interventions/ir.json' },
	},
	{
		runId: DISCOVERY,
		actor: 'operator:ops-1',
		at,
		kind: 'human_action',
		actionKind: 'click',
		verdict: 'allow',
		refused: false,
		fingerprint: 'click button "Search" in frame content',
	},
	{ ...replay, kind: 'result', resultKind: 'business_outcome', code: 'member_not_found', durationMs: 3100 },
].map((entry, index) => ({ seq: index + 1, ...entry }));

describe('RunLogEntrySchema', () => {
	it('covers every entry kind in the fixtures', () => {
		expect(new Set(entries.map((entry) => entry.kind))).toEqual(new Set(RUN_LOG_ENTRY_KINDS));
		expect([...RUN_LOG_ENTRY_KINDS]).toEqual([
			'run_started',
			'observation',
			'decision',
			'policy_verdict',
			'locator_resolved',
			'action',
			'checkpoint',
			'condition_detected',
			'recovery',
			'lease_change',
			'intervention',
			'human_action',
			'result',
		]);
		expect(RunLogEntrySchema.options.map((option) => option.shape.kind.value)).toEqual([...RUN_LOG_ENTRY_KINDS]);
	});

	it.each(entries.map((entry) => [entry.kind, entry] as const))('accepts a %s entry', (_kind, entry) => {
		expect(RunLogEntrySchema.parse(entry)).toEqual(entry);
	});

	it('rejects an unknown kind', () => {
		const result = RunLogEntrySchema.safeParse({ ...entries[0], kind: 'thought' });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['kind']);
	});

	it('rejects a missing common field (seq, at, runId, actor)', () => {
		for (const key of ['seq', 'at', 'runId', 'actor'] as const) {
			const missing = Object.fromEntries(Object.entries(entries[5] ?? {}).filter(([name]) => name !== key));
			const result = RunLogEntrySchema.safeParse(missing);
			expect(result.success, key).toBe(false);
			expect(result.error?.issues[0]?.path, key).toEqual([key]);
		}
	});

	it('rejects an unknown key such as a raw secret, including inside nested payloads', () => {
		expect(RunLogEntrySchema.safeParse({ ...entries[6], password: 'hunter2' }).success).toBe(false);
		const transition = { ...(entries[11] as { transition: object }).transition, token: 'abc' };
		expect(RunLogEntrySchema.safeParse({ ...entries[11], transition }).success).toBe(false);
	});

	it('rejects an unredacted evidence ref', () => {
		const result = RunLogEntrySchema.safeParse({ ...entries[2], snapshotRef: { ...ref, redacted: false } });
		expect(result.success).toBe(false);
	});

	it('accepts decision entries only on discovery runs', () => {
		const result = RunLogEntrySchema.safeParse({ ...entries[3], runId: REPLAY, actor: 'replay' });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['kind']);
	});

	it('requires human_action entries to come from an operator', () => {
		const result = RunLogEntrySchema.safeParse({ ...entries[13], actor: 'agent' });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['actor']);
	});

	it('keeps the machine actor consistent with the run kind', () => {
		const agentOnReplay = RunLogEntrySchema.safeParse({ ...entries[5], actor: 'agent' });
		expect(agentOnReplay.success).toBe(false);
		expect(agentOnReplay.error?.issues[0]?.path).toEqual(['actor']);
		const replayOnDiscovery = RunLogEntrySchema.safeParse({ ...entries[2], actor: 'replay' });
		expect(replayOnDiscovery.success).toBe(false);
	});

	it('keeps run_started.runKind consistent with the run id', () => {
		const result = RunLogEntrySchema.safeParse({ ...entries[0], runKind: 'discovery' });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['runKind']);
	});

	it('rejects a recovery attempt beyond its budget', () => {
		const result = RunLogEntrySchema.safeParse({ ...entries[10], attempt: 2, budget: 1 });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['attempt']);
	});

	it('rejects bad enum payloads', () => {
		expect(RunLogEntrySchema.safeParse({ ...entries[4], verdict: 'maybe' }).success).toBe(false);
		expect(RunLogEntrySchema.safeParse({ ...entries[7], result: 'passed' }).success).toBe(false);
		expect(RunLogEntrySchema.safeParse({ ...entries[14], resultKind: 'recoverable' }).success).toBe(false);
		expect(RunLogEntrySchema.safeParse({ ...entries[5], rungKind: 'css' }).success).toBe(false);
		expect(RunLogEntrySchema.safeParse({ ...entries[6], actionKind: 'eval_js' }).success).toBe(false);
	});

	it('recovery kinds mirror the Recovery union', () => {
		const recoveryEntry = RunLogEntrySchema.options.find((option) => option.shape.kind.value === 'recovery');
		const kinds = RecoverySchema.options.map((option) => option.shape.kind.value);
		for (const recoveryKind of kinds) {
			expect(recoveryEntry?.safeParse({ ...entries[10], recoveryKind }).success, recoveryKind).toBe(true);
		}
	});

	it('RunLogEntryInput is an entry without seq', () => {
		expectTypeOf<RunLogEntryInput>().toEqualTypeOf<
			RunLogEntry extends infer Entry ? (Entry extends unknown ? Omit<Entry, 'seq'> : never) : never
		>();
		const input: RunLogEntryInput = {
			runId: REPLAY,
			actor: 'replay',
			at,
			kind: 'result',
			resultKind: 'success',
			durationMs: 1,
		};
		expect(input.kind).toBe('result');
	});

	it('exports to JSON Schema', () => {
		expect(() => z.toJSONSchema(RunLogEntrySchema)).not.toThrow();
	});
});
