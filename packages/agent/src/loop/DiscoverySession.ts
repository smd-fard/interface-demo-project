import type { RunId } from '@idp/artifact-schema';
import type { EvidenceStore, RunLog } from '@idp/evidence';
import type { ApprovalOutcome, ApprovalStep, ControlLease, EscalationOutcome, LiveSession } from '@idp/session';
import type { Surface } from '@idp/surface';

/**
 * What the discovery loop needs from a live session — `LiveSession` satisfies it. `surface` is the leased,
 * policy-guarded surface: the loop never sees an unguarded one (invariant 2).
 */
export interface DiscoverySession {
	readonly surface: Surface;
	readonly runId: RunId;
	readonly evidence: Pick<EvidenceStore, 'putJson'>;
	readonly runLog: Pick<RunLog, 'log'>;
	readonly lease: Pick<ControlLease, 'reacquire'>;
	/** Non-null when the session is attended (an operator can answer interventions). */
	readonly controlUrl: string | null;
	requestApproval(step: ApprovalStep): Promise<ApprovalOutcome>;
	escalate(
		reason: Parameters<LiveSession['escalate']>[0],
		currentStep: Parameters<LiveSession['escalate']>[1],
	): Promise<EscalationOutcome>;
}
