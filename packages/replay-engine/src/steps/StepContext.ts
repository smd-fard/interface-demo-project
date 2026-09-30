import type { OutputSpec, RunId } from '@idp/artifact-schema';
import type { Clock, RunLog } from '@idp/evidence';
import type { Redactor } from '@idp/policy';
import type { ApprovalGrant, Surface } from '@idp/surface';
import type { CheckpointVerifier } from '../checkpoints/CheckpointVerifier.js';
import type { ValueBinder } from '../params/bindValues.js';
import type { ReplayOptions } from '../ReplayOptions.js';
import type { RunState } from './RunState.js';

/** Everything a step handler needs. Built once per run by the engine. */
export interface StepContext {
	readonly runId: RunId;
	/** The session's leased, policy-guarded surface. */
	readonly surface: Surface;
	readonly runLog: Pick<RunLog, 'log'>;
	readonly redactor: Redactor;
	readonly binder: ValueBinder;
	readonly verifier: CheckpointVerifier;
	readonly options: ReplayOptions;
	readonly clock: Clock;
	/** The artifact's outputs by name (an extract step checks its output's sensitivity). */
	readonly outputs: ReadonlyMap<string, OutputSpec>;
	readonly state: RunState;
	/**
	 * The operator's single-use approval for this step (step 34), set only on the retry after a grant. The guard
	 * validates and consumes it; for a click it also accepts the step's own native confirm as part of the action.
	 */
	readonly approvalGrant?: ApprovalGrant;
	/** Waits before a retry (the backoff). Default: a real timer; unit tests inject an instant one. */
	readonly sleep?: (ms: number) => Promise<void>;
}

/** The step being run: its 0-based index and id. */
export interface StepPosition {
	readonly index: number;
	readonly id: string;
}
