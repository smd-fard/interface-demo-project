import type { RecoveryPlan } from '../conditions/ConditionReply.js';
import type { DetectedCondition } from '../conditions/DetectedCondition.js';
import { ReplayError } from '../errors/ReplayError.js';
import type { StepContext, StepPosition } from '../steps/StepContext.js';
import { logRecovery } from './logRecovery.js';
import { performRecoveryAction } from './performRecoveryAction.js';
import { recoveryFailure } from './recoveryFailure.js';
import type { StepRecovery } from './StepRecovery.js';

/** The known-dialog condition, its settle plan and the step budget `dismissKnownDialog` spends. */
export interface DismissKnownDialogInput {
	readonly condition: DetectedCondition;
	readonly plan: Extract<RecoveryPlan, { kind: 'dismiss_dialog' }>;
	readonly position: StepPosition | null;
	readonly context: StepContext;
	readonly recovery: StepRecovery;
}

/**
 * Settles a recognised native dialog as its rule says (accept or dismiss), through the guarded surface with a
 * `dismiss_dialog` action that matches only a dialog containing the rule's text — at most
 * `maxDialogDismissPerStep` times per step (step 38). Over budget → `recovery_exhausted`, the dialog left open.
 * Each attempt is logged as a `recovery` entry.
 */
export async function dismissKnownDialog(input: DismissKnownDialogInput): Promise<void> {
	const { condition, plan, position, context, recovery } = input;
	const budget = context.options.maxDialogDismissPerStep;
	if (recovery.dismissals >= budget) {
		throw new ReplayError('recovery_exhausted', {
			step: position,
			expected: `at most ${budget} known dialog(s) settled per step`,
			observed: `${condition.code} (${condition.signal}) with ${recovery.dismissals} of ${budget} dismissal(s) used; the dialog is left open`,
		});
	}
	recovery.dismissals += 1;
	const attempt = {
		code: condition.code,
		recoveryKind: 'dismiss_dialog',
		attempt: recovery.dismissals,
		budget,
	} as const;
	const stepId = position?.id ?? null;
	try {
		await performRecoveryAction(
			{
				kind: 'dismiss_dialog',
				actor: 'replay',
				...(stepId === null ? {} : { stepId }),
				bindings: context.binder.bindings,
				timeoutMs: context.options.stepTimeoutMs,
				match: plan.match,
				action: plan.action,
			},
			position,
			context,
		);
	} catch (error) {
		logRecovery({ ...attempt, outcome: 'failed', stepId }, context);
		throw recoveryFailure(error, `settling the ${condition.code} dialog`, position) ?? error;
	}
	logRecovery({ ...attempt, outcome: 'succeeded', stepId }, context);
}
