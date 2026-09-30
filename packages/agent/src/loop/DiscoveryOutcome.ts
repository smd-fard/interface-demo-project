import type { Checkpoint, InterventionId } from '@idp/artifact-schema';
import type { DiscoveryTrace } from '../trace/DiscoveryTrace.js';

/**
 * Why a discovery run stopped without meeting its goal. `max_steps`: the model-turn budget ran out.
 * `timeout`: the wall-clock budget ran out. `dead_end`: no progress (the same screen three times, or an
 * A-B-A-B oscillation) and no operator helped. `policy_blocked`: three consecutive policy denials, or an
 * irreversible action that no operator approved (unattended or timed out). `goal_unverified`: two finishes whose
 * checkpoint did not hold. `model_gave_up`: the model answered without a tool call, or asked for help and no
 * operator helped. `human_aborted`: an operator aborted the run or rejected an approval.
 */
export const STOP_REASONS = [
	'max_steps',
	'timeout',
	'dead_end',
	'policy_blocked',
	'goal_unverified',
	'model_gave_up',
	'human_aborted',
] as const;
/** One of `STOP_REASONS`. */
export type StopReason = (typeof STOP_REASONS)[number];

/**
 * The outcome of a discovery loop. Only `goal_met` compiles into an artifact (FR6, AC2).
 */
export type DiscoveryOutcome =
	| {
			readonly kind: 'goal_met';
			/** The trace, with `finish` set to the verified final checkpoint. */
			readonly trace: DiscoveryTrace;
			readonly finalCheckpoint: Checkpoint;
			/** The model's summary, placeholderized. */
			readonly summary: string;
			/**
			 * The extracted output values by name, raw. In memory only: sensitive, so redact before any sink. The
			 * runner scans the artifact for them (assertNoConcreteValues) and masks them in `result.json`.
			 */
			readonly extracted: Readonly<Record<string, string>>;
			/** Model turns used. */
			readonly turns: number;
	  }
	| {
			readonly kind: 'stopped';
			readonly reason: StopReason;
			/** What happened, redacted (placeholderized). */
			readonly detail: string;
			readonly trace: DiscoveryTrace;
			readonly turns: number;
			/** The intervention request raised when the loop asked for help, if any. */
			readonly interventionRequestId?: InterventionId;
	  };
