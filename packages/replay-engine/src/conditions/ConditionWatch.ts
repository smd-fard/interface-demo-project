import type { ConditionSignature } from '@idp/artifact-schema';
import type { Observation } from '@idp/surface';
import type { ConditionDetector } from '../checkpoints/ConditionDetector.js';
import { detectConditions, type ConditionMatch } from './detectConditions.js';
import type { ResolvedRule } from './resolveRules.js';

/** The engine-detected code for a pending native dialog no rule recognises (catalog: failure, step 42). */
export const UNKNOWN_DIALOG = 'unknown_dialog';

function isDialogSignature(signature: ConditionSignature): boolean {
	if (signature.kind === 'any_of') return signature.signatures.some((leaf) => leaf.kind === 'dialog_text');
	return signature.kind === 'dialog_text';
}

/**
 * The detector for one step: the rules resolved for that step (artifact → profile → the profile's known dialogs),
 * evaluated over each observation. It remembers the last match per code, so the step runner can respond with the
 * rule (class, recovery, message target) and the matched signature text after the verifier or pre-observe
 * reported just the code.
 *
 * A pending native dialog blocks the page (no DOM, no text, no title): while one is open only the dialog rules are
 * evaluated, and a dialog none of them recognises is `unknown_dialog` — the run never settles it by guessing.
 */
export class ConditionWatch {
	private readonly matches = new Map<string, ConditionMatch>();
	private readonly dialogRules: readonly ResolvedRule[];

	constructor(readonly rules: readonly ResolvedRule[]) {
		this.dialogRules = rules.filter((rule) => isDialogSignature(rule.signature));
	}

	/** The `ConditionDetector` seam of `CheckpointVerifier` and the pre-step observation. */
	readonly detect: ConditionDetector = (observation: Observation) => {
		const dialog = observation.pendingDialog !== null;
		const match = detectConditions(dialog ? this.dialogRules : this.rules, observation);
		if (match === null) return dialog ? UNKNOWN_DIALOG : null;
		this.matches.set(match.code, match);
		return match.code;
	};

	/** The last match for a code this watch reported, or `null` (e.g. an engine-detected code). */
	matchFor(code: string): ConditionMatch | null {
		return this.matches.get(code) ?? null;
	}
}
