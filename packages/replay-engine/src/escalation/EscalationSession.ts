import type { ReplaySession } from '../ReplaySession.js';

/** What the approval gate and the escalation need from the live session (step 34). */
export type EscalationSession = Pick<ReplaySession, 'requestApproval' | 'escalate' | 'lease'>;
