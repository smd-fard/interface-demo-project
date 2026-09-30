import { ACTION_REGISTRY } from '@idp/policy';
import type { ActOutcome, SurfaceAction } from '@idp/surface';
import type { StepContext, StepPosition } from '../steps/StepContext.js';

/**
 * Performs a recovery's own action (settle a known dialog, reload the entry route) through the session's leased,
 * policy-guarded surface — the same guard every step goes through (invariant 2) — and logs it as an `action`
 * entry with the registry risk of its kind and the step it recovers. Errors propagate (see `recoveryFailure`).
 */
export async function performRecoveryAction(
	action: SurfaceAction,
	position: StepPosition | null,
	context: StepContext,
): Promise<ActOutcome> {
	const started = context.clock.now().getTime();
	const outcome = await context.surface.act(action);
	context.runLog.log({
		kind: 'action',
		at: context.clock.now().toISOString(),
		runId: context.runId,
		actor: 'replay',
		actionKind: action.kind,
		risk: ACTION_REGISTRY[action.kind].risk,
		...(position === null ? {} : { stepId: position.id }),
		durationMs: Math.max(0, context.clock.now().getTime() - started),
	});
	return outcome;
}
