import type { InterventionId, Step } from '@idp/artifact-schema';
import type { ApprovalOutcome } from '@idp/session';
import { ApprovalRequiredError, type ApprovalGrant } from '@idp/surface';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckpointVerifier } from '../checkpoints/CheckpointVerifier.js';
import { ReplayError } from '../errors/ReplayError.js';
import { fakeReplaySession, type FakeReplaySessionFixture } from '../fakeReplaySession.test-helper.js';
import { createValueBinder } from '../params/bindValues.js';
import { InMemoryCredentialProvider } from '../params/InMemoryCredentialProvider.js';
import { resolveReplayOptions } from '../ReplayOptions.js';
import { RunState } from '../steps/RunState.js';
import type { StepContext } from '../steps/StepContext.js';
import type { StepOutcome } from '../steps/StepOutcome.js';
import type { EscalationSession } from './EscalationSession.js';
import { handleApproval } from './handleApproval.js';

const REQUEST = 'ivr-0001' as InterventionId;
const confirm: Step = {
	id: 's12-click-confirm',
	kind: 'click',
	description: 'Confirm and open the sub-account.',
	phase: 'main',
	risk: 'irreversible',
	target: {
		description: 'Confirm button',
		frame: [],
		ladder: [{ kind: 'role', role: 'button', name: 'Confirm', exact: true, rationale: 'unit test' }],
	},
	checkpoint: { kind: 'text_present', text: 'Sub-Account Opened' },
};
const position = { index: 11, id: confirm.id };
const refused = new ApprovalRequiredError({ actionKind: 'click', reason: 'control Confirm', stepId: confirm.id });
const grant = { id: 'grant-1' } as unknown as ApprovalGrant;

describe('handleApproval (step 34)', () => {
	let fixture: FakeReplaySessionFixture;
	afterEach(async () => {
		await fixture.cleanup();
	});

	async function setup(outcome: ApprovalOutcome) {
		fixture = await fakeReplaySession();
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
		const requestApproval = vi.fn(async () => outcome);
		const session: EscalationSession = {
			requestApproval,
			escalate: () => Promise.reject(new Error('not used')),
			lease: { state: () => 'AGENT', reacquire: async () => 'AGENT' },
		} as unknown as EscalationSession;
		const retry = vi.fn<(grant: ApprovalGrant) => Promise<StepOutcome>>(async () => ({ kind: 'completed' }));
		const run = () => handleApproval({ error: refused, step: confirm, position, context, session, retry });
		return { run, retry, requestApproval };
	}

	async function failureOf(promise: Promise<unknown>): Promise<ReplayError> {
		const error = await promise.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(ReplayError);
		return error as ReplayError;
	}

	it('raises an approval request for the step, bounded by approvalTimeoutMs', async () => {
		const { run, requestApproval } = await setup({ kind: 'granted', requestId: REQUEST, grant });
		await run();
		expect(requestApproval).toHaveBeenCalledWith(
			{ index: 11, stepId: 's12-click-confirm', description: 'Confirm and open the sub-account.' },
			{ timeoutMs: 5000 },
		);
	});

	it('granted: retries the same step once with the grant', async () => {
		const { run, retry } = await setup({ kind: 'granted', requestId: REQUEST, grant });
		expect(await run()).toEqual({ kind: 'completed' });
		expect(retry).toHaveBeenCalledTimes(1);
		expect(retry).toHaveBeenCalledWith(grant);
	});

	it('granted but the guard refuses the grant: approval_required with the ref, never a second request', async () => {
		const { run, retry, requestApproval } = await setup({ kind: 'granted', requestId: REQUEST, grant });
		retry.mockRejectedValueOnce(new ApprovalRequiredError({ ...refused, grantRejection: 'reused' }));
		expect(await failureOf(run())).toMatchObject({
			code: 'approval_required',
			step: position,
			interventionRequestId: REQUEST,
			observed: 'the approval grant was not accepted (reused)',
		});
		expect(requestApproval).toHaveBeenCalledTimes(1);
	});

	it.each([
		['rejected', 'approval_rejected'],
		['timeout', 'timeout'],
		['aborted', 'human_aborted'],
		['unattended', 'approval_required'],
	] as const)('%s → failure %s with the request ref; the step is not retried', async (kind, code) => {
		const { run, retry } = await setup({ kind, requestId: REQUEST });
		expect(await failureOf(run())).toMatchObject({ code, step: position, interventionRequestId: REQUEST });
		expect(retry).not.toHaveBeenCalled();
	});
});
