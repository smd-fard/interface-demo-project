import type { RunId } from '@idp/artifact-schema';
import type { EvidenceStore, RunLog, RunManifestWriter } from '@idp/evidence';
import type { ControlLease, LiveSession } from '@idp/session';
import type { Surface } from '@idp/surface';

/**
 * What replay needs from a live session: a narrow view of `@idp/session`'s `LiveSession` (which satisfies it),
 * so unit tests can supply a fake. `surface` must be the session's leased, policy-guarded surface: every step
 * acts through it, so policy runs inside the guard before each action (invariant 2).
 */
export interface ReplaySession {
	readonly runId: RunId;
	/** The leased, policy-guarded surface (never a raw one). */
	readonly surface: Surface;
	/** The redacting run log. */
	readonly runLog: Pick<RunLog, 'log'>;
	readonly evidence: Pick<EvidenceStore, 'putScreenshot' | 'putA11ySnapshot'>;
	readonly manifest: Pick<RunManifestWriter, 'setArtifact' | 'writeResult' | 'writeManifest'>;
	/** The control lease (step 34: re-verify, then reacquire after a takeover). */
	readonly lease: Pick<ControlLease, 'state' | 'reacquire'>;
	/** Raise an approval request for an irreversible step (step 34). */
	requestApproval: LiveSession['requestApproval'];
	/** Raise a takeover request and wait for the operator (step 34). */
	escalate: LiveSession['escalate'];
}
