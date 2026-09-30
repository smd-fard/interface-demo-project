import { FrameNotFoundError, TargetNotResolvedError } from '@idp/surface';
import { ReplayError } from '../errors/ReplayError.js';
import type { StepContext, StepPosition } from '../steps/StepContext.js';
import type { ConditionReply, RecoveryPlan } from './ConditionReply.js';
import type { DetectedCondition } from './DetectedCondition.js';
import { failureReasonFor } from './failureReasonFor.js';

/**
 * The business-outcome message: the text of the rule's `message` target when it declares one and it resolves,
 * else the matched signature text. Read with `surface.resolve` (an observation: no action, nothing changes). It
 * is redacted by the ResultBuilder before the result is returned or written.
 */
async function outcomeMessage(condition: DetectedCondition, context: StepContext): Promise<string> {
	const fallback = condition.match?.matchedText ?? condition.code;
	const target = condition.rule?.message;
	if (target === undefined) return fallback;
	try {
		const text = (await context.surface.resolve(target, context.binder.bindings)).fingerprint?.visibleText ?? '';
		return text.trim() === '' ? fallback : text;
	} catch (error) {
		// The outcome is already recognised by its signature; a message element that cannot be read only loses the
		// app's exact wording, so fall back to the signature text. Anything else is a real problem: rethrow.
		if (error instanceof TargetNotResolvedError || error instanceof FrameNotFoundError) return fallback;
		throw error;
	}
}

function where(position: StepPosition | null): string {
	return position === null ? 'the success condition' : position.id;
}

/** A recoverable condition with no recovery the engine can run: exhausted before it starts (never a guess). */
function noRecovery(condition: DetectedCondition, position: StepPosition | null, why: string): ReplayError {
	return new ReplayError('recovery_exhausted', {
		step: position,
		expected: `a bounded recovery for ${condition.code} at ${where(position)}`,
		observed: `${condition.code} (${condition.source}): ${condition.signal}; ${why}`,
	});
}

/**
 * The recovery plan of a recoverable condition: the rule's recovery (artifact or profile), else the catalog's,
 * with the run's `ReplayOptions` as the ceiling (a rule can ask for fewer retries or a shorter backoff, never more).
 */
function planFor(condition: DetectedCondition, position: StepPosition | null, context: StepContext): RecoveryPlan {
	const { retry } = context.options;
	const recovery = condition.rule?.recovery;
	if (recovery !== undefined) {
		switch (recovery.kind) {
			case 'dismiss_dialog': {
				const match = condition.match?.matchedText;
				if (condition.match === null || match === undefined) {
					throw noRecovery(condition, position, 'a dialog recovery needs a dialog_text signature to match');
				}
				return { kind: 'dismiss_dialog', match, action: recovery.action };
			}
			case 'retry':
				return {
					kind: 'retry',
					max: Math.min(recovery.max, retry.max),
					backoffMs: Math.min(recovery.backoffMs, retry.backoffMs),
				};
			case 'reauth':
				return { kind: 'reauth' };
			case 'click_through':
				throw noRecovery(condition, position, 'click_through recoveries are not supported by this engine');
		}
	}
	const response = condition.entry?.response;
	if (response?.kind !== 'recover') throw noRecovery(condition, position, 'no recovery is declared for it');
	switch (response.recovery) {
		case 'retry':
			return { kind: 'retry', max: retry.max, backoffMs: retry.backoffMs };
		case 'reauth':
			return { kind: 'reauth' };
		case 'wait':
			return { kind: 'wait' };
		case 'dismiss_dialog':
		case 'click_through':
			// Settling a dialog or clicking through needs the rule's action or target: never guessed.
			throw noRecovery(condition, position, `a ${response.recovery} recovery needs a rule that declares it`);
	}
}

/**
 * The deliberate response to a classified runtime condition (define-runtime-condition touch point 3), by its
 * class (artifact rule → app profile → catalog default). Logs `condition_detected` first.
 *
 * - `business_outcome`: stop cleanly, no retry: the outcome with a (later redacted) message.
 * - `recoverable`: the bounded recovery plan (the step runner performs it and logs each attempt as `recovery`;
 *   an exhausted budget ends the run as `recovery_exhausted` or `session_lost`, never as an outcome).
 * - `failure`: thrown as a `ReplayError` with the condition's failure reason (`failureReasonFor`); app_error and
 *   unknown_dialog escalate (step 34).
 *
 * `position` null means the artifact's success condition; an outcome is then attributed to `lastStepId`.
 */
export async function respondToCondition(
	condition: DetectedCondition,
	position: StepPosition | null,
	lastStepId: string,
	context: StepContext,
): Promise<ConditionReply> {
	context.runLog.log({
		kind: 'condition_detected',
		at: context.clock.now().toISOString(),
		runId: context.runId,
		actor: 'replay',
		code: condition.code,
		class: condition.class,
		stepId: position?.id ?? null,
	});
	switch (condition.class) {
		case 'business_outcome':
			return {
				kind: 'outcome',
				result: {
					kind: 'business_outcome',
					code: condition.code,
					message: await outcomeMessage(condition, context),
					stepId: position?.id ?? lastStepId,
				},
			};
		case 'recoverable':
			return { kind: 'recover', plan: planFor(condition, position, context), condition };
		case 'failure':
			throw new ReplayError(failureReasonFor(condition.code), {
				step: position,
				expected: `${where(position)} to complete without a ${condition.code} condition`,
				observed: `${condition.code} (${condition.source}): ${condition.signal}`,
			});
	}
}
