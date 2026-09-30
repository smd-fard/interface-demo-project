import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	CapabilityArtifactSchema,
	RunResultSchema,
	type CapabilityArtifact,
	type RunLogEntry,
	type RunResult,
} from '@idp/artifact-schema';
import { RunLog } from '@idp/evidence';
import { createRedactor, resolvePolicy } from '@idp/policy';
import { openLiveSession } from '@idp/session';
import { launchMockBank, mockBankPolicyConfig, type MockBank } from '@idp/surface/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryCredentialProvider, replay } from '../../src/index.js';

/** Synthetic seed values (apps/mock-bank/src/data): none may reach run.jsonl or result.json. */
const SECRETS = ['12345', 'Jane Sample', 'synthetic-pass-01', 'teller01', '1523.47'];

async function loadFixture(): Promise<CapabilityArtifact> {
	const url = new URL('../../../artifact-schema/fixtures/member-lookup.artifact.json', import.meta.url);
	return CapabilityArtifactSchema.parse(JSON.parse(await readFile(url, 'utf8')));
}

interface Run {
	readonly result: RunResult;
	readonly entries: RunLogEntry[];
	readonly logText: string;
	readonly resultText: string;
}

describe('replay: member-lookup against mock-bank (AC4, AC8, FR11)', () => {
	let tenantA: MockBank;
	let tenantB: MockBank;
	let root: string;
	let fixture: CapabilityArtifact;

	beforeAll(async () => {
		[tenantA, tenantB] = await Promise.all([launchMockBank({ tenant: 'a' }), launchMockBank({ tenant: 'b' })]);
		root = await mkdtemp(path.join(tmpdir(), 'idp-replay-'));
		fixture = await loadFixture();
	});
	afterAll(async () => {
		await Promise.all([tenantA?.stop(), tenantB?.stop()]);
		if (root !== undefined) await rm(root, { recursive: true, force: true });
	});

	async function run(bank: MockBank, artifact: unknown, params: Record<string, unknown>): Promise<Run> {
		const policy = resolvePolicy(mockBankPolicyConfig(bank.origin));
		// The replay engine seeds this redactor (params, credentials, extracted outputs); the session's sinks use it.
		const redactor = createRedactor({ config: policy, sensitiveValues: [] });
		const session = await openLiveSession({
			policy,
			redactor,
			runsRoot: root,
			runKind: 'replay',
			origin: bank.origin,
			headless: true,
			attended: false,
			subject: { kind: 'capability', id: fixture.id, version: fixture.version },
		});
		let result: RunResult;
		try {
			result = await replay({
				artifact,
				params,
				session,
				redactor,
				origin: bank.origin,
				credentials: new InMemoryCredentialProvider({
					'mockbank-operator': { username: 'teller01', password: 'synthetic-pass-01' },
				}),
				options: { attended: false },
			});
		} finally {
			await session.close();
		}
		return {
			result,
			entries: await RunLog.read(session.runLog.path),
			logText: await readFile(session.runLog.path, 'utf8'),
			resultText: await readFile(session.runDir.resultPath, 'utf8'),
		};
	}

	function expectNoSecrets({ logText, resultText }: Run): void {
		for (const secret of SECRETS) {
			expect(logText, `run.jsonl leaks ${secret}`).not.toContain(secret);
			expect(resultText, `result.json leaks ${secret}`).not.toContain(secret);
		}
	}

	it('tenant A: success with the seeded savings balance and name; every step logs its rung and checkpoint', async () => {
		const outcome = await run(tenantA, fixture, { memberId: '12345' });
		const result = RunResultSchema.parse(outcome.result);
		expect(result).toMatchObject({
			kind: 'success',
			outputs: { savingsBalance: '1523.47', memberName: 'Jane Sample' },
			drift: [],
			recoveries: 0,
			artifact: { id: 'member-lookup', version: '1.0.1', contentHash: fixture.contentHash },
		});

		const { entries } = outcome;
		expect(entries[0]).toMatchObject({ kind: 'run_started', runKind: 'replay', actor: 'replay' });
		// session.close() appends the CLOSED lease change after the result.
		expect(entries.filter((entry) => entry.kind !== 'lease_change').at(-1)).toMatchObject({
			kind: 'result',
			resultKind: 'success',
		});
		for (const step of fixture.steps) {
			const forStep = entries.filter((entry) => 'stepId' in entry && entry.stepId === step.id);
			expect(
				forStep.filter((entry) => entry.kind === 'action'),
				step.id,
			).toHaveLength(1);
			// Policy ran for the step, inside the guard, before the action.
			const verdict = forStep.findIndex((entry) => entry.kind === 'policy_verdict');
			const action = forStep.findIndex((entry) => entry.kind === 'action');
			expect(verdict, `${step.id} policy verdict`).toBeGreaterThanOrEqual(0);
			expect(verdict).toBeLessThan(action);
			if ('target' in step && step.target !== undefined) {
				expect(
					forStep.find((entry) => entry.kind === 'locator_resolved'),
					step.id,
				).toMatchObject({ rungIndex: 0 });
			}
			if (step.checkpoint !== undefined) {
				expect(
					forStep.find((entry) => entry.kind === 'checkpoint'),
					step.id,
				).toMatchObject({ result: 'held' });
			}
		}
		expect(entries.find((entry) => entry.kind === 'checkpoint' && entry.stepId === null)).toMatchObject({
			result: 'held',
		});
		expect(JSON.parse(outcome.resultText)).toMatchObject({
			kind: 'success',
			outputs: { savingsBalance: '[REDACTED]', memberName: '[REDACTED]' },
		});
		expectNoSecrets(outcome);
	});

	it('tenant B: Member # and Search drift to their structural last-resort rungs; success with drift (FR11)', async () => {
		const outcome = await run(tenantB, fixture, { memberId: '12345' });
		expect(RunResultSchema.parse(outcome.result)).toMatchObject({
			kind: 'success',
			outputs: { savingsBalance: '1523.47', memberName: 'Jane Sample' },
			drift: [
				{ stepId: 's05-fill-member-id', rungIndex: 1, rungKind: 'structural' },
				{ stepId: 's06-click-search', rungIndex: 2, rungKind: 'structural' },
			],
			artifact: { id: 'member-lookup', version: '1.0.1', contentHash: fixture.contentHash },
		});
		if (outcome.result.kind !== 'success') throw new Error('unreachable');
		expect(outcome.result.drift.length).toBeGreaterThan(0);
		expect(
			outcome.entries.find((entry) => entry.kind === 'locator_resolved' && entry.stepId === 's06-click-search'),
		).toMatchObject({ rungIndex: 2, rungKind: 'structural' });
		expectNoSecrets(outcome);
	});

	it('invalid params (memberId "abc"): failure invalid_params with zero actions logged (AC8)', async () => {
		const outcome = await run(tenantA, fixture, { memberId: 'abc' });
		expect(RunResultSchema.parse(outcome.result)).toMatchObject({
			kind: 'failure',
			reason: 'invalid_params',
			step: null,
			evidence: [],
		});
		const kinds = outcome.entries.map((entry) => entry.kind);
		expect(kinds).not.toContain('action');
		expect(kinds).not.toContain('policy_verdict');
		expect(kinds).not.toContain('locator_resolved');
		expect(kinds.filter((kind) => kind !== 'lease_change')).toEqual(['run_started', 'result']);
		expect(outcome.logText).not.toContain('abc');
		expectNoSecrets(outcome);
	});
});
