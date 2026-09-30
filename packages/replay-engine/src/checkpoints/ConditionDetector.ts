import type { Observation } from '@idp/surface';

/**
 * The runtime-condition seam (plan step 35+): inspects an observation and returns the code of the condition it
 * shows (e.g. `member_not_found`), or `null`. Must be pure and deterministic: no model, no I/O.
 */
export type ConditionDetector = (observation: Observation) => string | null;
