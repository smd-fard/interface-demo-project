import type { InterventionId, Step } from '@idp/artifact-schema';
import type { EscalationOutcome } from '@idp/session';
import type { CheckResult } from '@idp/surface';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckpointVerifier } from '../checkpoints/CheckpointVerifier.js';
import { ReplayError } from '../errors/ReplayError.js';
import { fakeReplaySession, type FakeReplaySessionFixture } from '../fakeReplaySession.test-helper.js';
import { createValueBinder } from '../params/bindValues.js';
import { InMemoryCredentialProvider } from '../params/InMemoryCredentialProvider.js';
import { resolveReplayOptions } from '../ReplayOptions.js';
import { RunState } from '../steps/RunState.js';
import type { StepContext } from '../steps/StepContext.js';
import type { EscalationSession } from './EscalationSession.js';
import { handleHardFailure } from './handleHardFailure.js';

const REQUEST = 'ivr-0002' as InterventionId;
const content = [{ kind: 'by_name' as const, name: 'content' }];
const search: Step = {
	id: 's06-click-search',
	kind: 'click',
	description: 'Run the search.',
	phase: 'main',
	risk: 'read',
	target: {
		description: 'Search button',
		frame: content,
		ladder: [{ kind: 'role', role: 'button', name: 'Search', exact: true, rationale: 'unit test' }],
	},
	checkpoint: { kind: 'text_present', text: 'Member Inquiry', frame: content },
};
const extract: Step = {
	id: 's07-extract-savings-balance',
	kind: 'extract',
	description: 'Read the balance.',
	phase: 'main',
	risk: 'read',
	target: search.target,
	output: 'savingsBalance',
	parse: { kind: 'decimal' },
};
const failure = new ReplayError('checkpoint_failed', {
	step: { index: 5, id: search.id },
	expected: 'text "Member Inquiry" present in frame content',
	observed: 'text "Member Inquiry" not present',
});

describe('handleHardFailure (step 34)', () => {
	let fixture: FakeReplaySessionFixture;
	afterEach(async () => {
		await fixture.cleanup();
	});

	async function setup(outcome: EscalationOutcome, checks: CheckResult[] = [{ kind: 'held' }]) {
		fixture = await fakeReplaySession({ checks });
		const context: StepContext = {
			runId: fixture.session.runId,
			surface: fixture.session.surface,
			runLog: fixture.session.runLog,
			redactor: fixture.redactor,
			binder: createValueBinder({
				params: {},
				credentials: new InMemoryCredentialProvider({}),
				redactor: fixture.redactor,
			}),
			verifier: new CheckpointVerifier({ surface: fixture.session.surface }),
			options: resolveReplayOptions({ approvalTimeoutMs: 5000 }),
			clock: fixture.clock,
			outputs: new Map(),
			state: new RunState(),
		};
		const calls: string[] = [];
		const escalate = vi.fn(async () => {
			calls.push('escalate');
			return outcome;
		});
		const session = {
			requestApproval: () => Promise.reject(new Error('not used')),
			escalate,
			lease: {
				state: () => 'RESUMING',
				reacquire: async () => {
					calls.push('reacquire');
					return 'AGENT';
				},
			},
		} as unknown as EscalationSession;
		const rerun = vi.fn(async () => {
			calls.push('rerun');
			return { kind: 'completed' } as const;
		});
		const run = (step: Step = search) =>
			handleHardFailure({ error: failure, step, position: { index: 5, id: step.id }, context, session, rerun });
		return { run, escalate, rerun, calls };
	}

	async function failureOf(promise: Promise<unknown>): Promise<ReplayError> {
		const error = await promise.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(ReplayError);
		return error as ReplayError;
	}

	it('raises a takeover with the failure code, the step and its risk, bounded by the intervention timeout', async () => {
		const { run, escalate } = await setup({ kind: 'resumed', requestId: REQUEST, humanActions: [] });
		await run();
		expect(escalate).toHaveBeenCalledWith(
			{
				code: 'checkpoint_failed',
				text: 'Expected text "Member Inquiry" present in frame content; observed text "Member Inquiry" not present',
			},
			{ index: 5, id: 's06-click-search', description: 'Run the search.', risk: 'read' },
			{ timeoutMs: 5000 },
		);
	});

	it('resumed and the checkpoint holds: re-verified first, then reacquired; the run continues', async () => {
		const { run, calls } = await setup({ kind: 'resumed', requestId: REQUEST, humanActions: [] });
		expect(await run()).toEqual({ kind: 'completed' });
		expect(calls).toEqual(['escalate', 'reacquire']);
		expect(fixture.calls).toContain('check');
		const entries = await fixture.runLog.entries();
		expect(entries.find((entry) => entry.kind === 'checkpoint')).toMatchObject({
			stepId: 's06-click-search',
			result: 'held',
		});
	});

	it('resumed but the checkpoint does not hold: checkpoint_failed with the ref, lease not reacquired', async () => {
		const { run, calls } = await setup({ kind: 'resumed', requestId: REQUEST, humanActions: [] }, [
			{ kind: 'not_held', observed: 'still the error page' },
		]);
		expect(await failureOf(run())).toMatchObject({
			code: 'checkpoint_failed',
			interventionRequestId: REQUEST,
			observed: 'still the error page',
		});
		expect(calls).toEqual(['escalate']);
	});

	it('resumed on a read-only step without a checkpoint: reacquire, then re-run it', async () => {
		const { run, calls } = await setup({ kind: 'resumed', requestId: REQUEST, humanActions: [] });
		expect(await run(extract)).toEqual({ kind: 'completed' });
		expect(calls).toEqual(['escalate', 'reacquire', 'rerun']);
	});

	it('unattended: the original failure, with the persisted request ref', async () => {
		const { run } = await setup({ kind: 'unattended', requestId: REQUEST });
		expect(await failureOf(run())).toMatchObject({
			code: 'checkpoint_failed',
			observed: failure.observed,
			interventionRequestId: REQUEST,
		});
	});

	it.each([
		['timeout', 'timeout'],
		['aborted', 'human_aborted'],
	] as const)('%s → failure %s with the ref', async (kind, code) => {
		const outcome: EscalationOutcome =
			kind === 'aborted' ? { kind, requestId: REQUEST, humanActions: [] } : { kind, requestId: REQUEST };
		const { run, rerun } = await setup(outcome);
		expect(await failureOf(run())).toMatchObject({ code, interventionRequestId: REQUEST });
		expect(rerun).not.toHaveBeenCalled();
	});
});
