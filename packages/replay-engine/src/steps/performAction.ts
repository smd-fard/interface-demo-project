import { maxRisk, type RiskClass, type Step } from '@idp/artifact-schema';
import type { ActOutcome, SurfaceAction } from '@idp/surface';
import type { StepContext, StepPosition } from './StepContext.js';

/**
 * How the action's load went, for the checkpoint: `loadPending` when the action ran to its bound (the surface
 * stopped waiting for the load it started before the page settled): a candidate slow load (step 39).
 */
export interface Landing {
	readonly loadPending: boolean;
	/** When the action began, on the run clock (ms): the slow-load budget counts from here. */
	readonly startedAt: number;
}

/** What `performAction` returns: the surface's outcome and how its load went. */
export interface Performed {
	readonly outcome: ActOutcome;
	readonly landing: Landing;
}

/**
 * Records the step's effective risk — the guard's classification when it reports one, never below the declared
 * risk nor below an earlier attempt's — and returns it (the risk the `action` entry logs).
 */
function recordEffectiveRisk(
	step: Step,
	position: StepPosition,
	classified: RiskClass | undefined,
	context: StepContext,
): RiskClass {
	const known = context.state.effectiveRisk.get(position.id);
	let risk = maxRisk(step.risk, classified ?? step.risk);
	if (known !== undefined) risk = maxRisk(risk, known);
	context.state.effectiveRisk.set(position.id, risk);
	return risk;
}

/** The step's effective risk: its declared risk, raised to what policy classified when it acted (`RunState`). */
export function effectiveRisk(step: Step, context: StepContext): RiskClass {
	const classified = context.state.effectiveRisk.get(step.id);
	return classified === undefined ? step.risk : maxRisk(step.risk, classified);
}

/** Kinds whose action can start a document load the surface waits for. */
const LOADING_KINDS: ReadonlySet<Step['kind']> = new Set(['navigate', 'click', 'press']);

/**
 * The fields every replayed action carries: actor `replay`, the step id, its declared risk, bindings, a bound, and
 * the approval grant when the step is retried after an operator approved it (step 34).
 */
export function actionBase(step: Step, context: StepContext) {
	return {
		actor: 'replay',
		stepId: step.id,
		// Policy can only raise this risk, never lower it (the guard takes the max).
		declaredRisk: step.risk,
		bindings: context.binder.bindings,
		timeoutMs: step.timeoutMs ?? context.options.stepTimeoutMs,
		...(context.approvalGrant === undefined ? {} : { approvalGrant: context.approvalGrant }),
	} as const;
}

/**
 * Performs one step's action through the session's leased, policy-guarded surface — so the policy check runs
 * inside the guard **before** the surface acts, and the landing is checked after (invariant 2) — then logs
 * `locator_resolved` (the rung; a rung above 0 is recorded as drift, FR11) and `action` (kind, effective risk, target
 * description and duration: never the typed or extracted value). Errors propagate to the step runner. A loading
 * kind (navigate, click, press) that took its whole bound reports `loadPending` (the surface waits for the load
 * it started at most that long, so the page may still be loading).
 */
export async function performAction(
	step: Step,
	position: StepPosition,
	action: SurfaceAction,
	context: StepContext,
): Promise<Performed> {
	const started = context.clock.now().getTime();
	const outcome = await context.surface.act(action);
	const durationMs = Math.max(0, context.clock.now().getTime() - started);
	const at = () => context.clock.now().toISOString();
	const risk = recordEffectiveRisk(step, position, outcome.risk, context);
	const resolution = outcome.resolution;
	if (resolution !== undefined) {
		context.runLog.log({
			kind: 'locator_resolved',
			at: at(),
			runId: context.runId,
			actor: 'replay',
			stepId: position.id,
			rungIndex: resolution.rungIndex,
			rungKind: resolution.rungKind,
		});
		if (resolution.rungIndex > 0) {
			context.state.drift.push({ stepId: position.id, rungIndex: resolution.rungIndex, rungKind: resolution.rungKind });
		}
	}
	context.runLog.log({
		kind: 'action',
		at: at(),
		runId: context.runId,
		actor: 'replay',
		actionKind: step.kind,
		risk,
		stepId: position.id,
		...('target' in step && step.target !== undefined ? { target: step.target.description } : {}),
		durationMs,
	});
	const bound = step.timeoutMs ?? context.options.stepTimeoutMs;
	return { outcome, landing: { loadPending: LOADING_KINDS.has(step.kind) && durationMs >= bound, startedAt: started } };
}
