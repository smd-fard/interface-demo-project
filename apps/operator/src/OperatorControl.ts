import type { ControlClient } from '@idp/session';

/**
 * What the console needs from the session: the `ControlClient` operations. The client holds the session's
 * bearer token, so the console process can call the control API while the browser never sees the token.
 */
export type OperatorControl = Pick<
	ControlClient,
	'lease' | 'interventions' | 'intervention' | 'evidence' | 'claim' | 'approve' | 'reject' | 'resume' | 'abort'
>;
