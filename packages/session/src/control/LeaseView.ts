import type { LeaseState, LeaseTransition } from '@idp/artifact-schema';
import type { LeaseHolder } from '../lease/ControlLease.js';

/** The lease as the control API serves it: state, holder and the (redacted) transition history. */
export interface LeaseView {
	readonly state: LeaseState;
	readonly holder: LeaseHolder;
	readonly history: readonly LeaseTransition[];
}
