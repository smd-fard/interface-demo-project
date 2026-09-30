import type { RiskClass, RunResult } from '@idp/artifact-schema';
import type { RawExtraction } from '../outputs/extractOutputs.js';

/** A step that resolved on a fallback rung (FR11). */
export type Drift = Extract<RunResult, { kind: 'success' }>['drift'][number];

/** What a run accumulates while its steps execute. */
export class RunState {
	/** Steps whose target resolved on a rung above 0, in order. */
	readonly drift: Drift[] = [];
	/** The raw text each extract step read, by output name. */
	readonly extractions = new Map<string, RawExtraction>();
	/** Bounded recovery attempts that ran, each logged as a `recovery` entry (steps 38+). */
	recoveries = 0;
	/** Re-authentications so far (session_timeout, bounded by `maxReauthPerRun`). */
	reauths = 0;
	/**
	 * The effective risk of each step that acted, by step id: the policy guard's classification (`ActOutcome.risk`,
	 * max of the declared risk and the policy rules), the highest seen over its attempts. Recovery reads it through
	 * `effectiveRisk` so a step policy raised to irreversible is never retried across.
	 */
	readonly effectiveRisk = new Map<string, RiskClass>();
}
