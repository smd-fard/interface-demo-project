import type { OutputSpec } from '@idp/artifact-schema';
import type { SurfaceAction } from '@idp/surface';
import type { CheckpointProposal } from './CheckpointProposal.js';
import type { ValueSource } from './ValueSource.js';

/** A validated tool call: an action for the policy-guarded surface, or a control signal for the loop. */
export type ToolDecision =
	| {
			readonly kind: 'action';
			readonly reason: string;
			/** Actor `agent`, targets by observation ref; a fill/select carries the resolved concrete value. */
			readonly action: SurfaceAction;
			/** For fill and select: where the value came from (literal, param or credential). */
			readonly valueSource?: ValueSource;
			/** For extract: the declared output that receives the text. */
			readonly output?: string;
	  }
	| {
			readonly kind: 'declare_output';
			readonly reason: string;
			readonly output: Required<Pick<OutputSpec, 'name' | 'description' | 'type' | 'sensitive'>>;
	  }
	| {
			readonly kind: 'finish';
			readonly reason: string;
			readonly summary: string;
			readonly finalCheckpoint: CheckpointProposal;
	  }
	| { readonly kind: 'request_help'; readonly reason: string };
