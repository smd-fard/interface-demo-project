import type { Checkpoint, KnownDialog, RiskClass, Step } from '@idp/artifact-schema';
import { ApprovalRequiredError } from '@idp/surface';
import { CheckpointVerifier } from '../checkpoints/CheckpointVerifier.js';
import { classifyCondition } from '../conditions/classifyCondition.js';
import { shouldEscalate } from '../conditions/ConditionCatalog.js';
import type { ConditionReply, RecoveryPlan } from '../conditions/ConditionReply.js';
import { ConditionWatch, UNKNOWN_DIALOG } from '../conditions/ConditionWatch.js';
import type { DetectedCondition } from '../conditions/DetectedCondition.js';
import { knownDialogRules } from '../conditions/knownDialogRules.js';
import { resolveRules, type RuleSources } from '../conditions/resolveRules.js';
import { respondToCondition } from '../conditions/respondToCondition.js';
import { ReplayError } from '../errors/ReplayError.js';
import { toReplayError } from '../errors/toReplayError.js';
import type { EscalationSession } from '../escalation/EscalationSession.js';
import { handleApproval } from '../escalation/handleApproval.js';
import { handleHardFailure } from '../escalation/handleHardFailure.js';
import { dismissKnownDialog } from '../recovery/dismissKnownDialog.js';
import { logRecovery } from '../recovery/logRecovery.js';
import { performRecoveryAction } from '../recovery/performRecoveryAction.js';
import { recoveryFailure } from '../recovery/recoveryFailure.js';
import { sleep } from '../recovery/sleep.js';
import { StepRecovery } from '../recovery/StepRecovery.js';
import { waitForSlowLoad } from '../recovery/waitForSlowLoad.js';
import { runClick } from './handlers/click.js';
import { runDismissDialog } from './handlers/dismissDialog.js';
import { runExtract } from './handlers/extract.js';
import { runFill } from './handlers/fill.js';
import { runNavigate } from './handlers/navigate.js';
import { runPress } from './handlers/press.js';
import { runSelect } from './handlers/select.js';
import { runWait } from './handlers/wait.js';
import { effectiveRisk } from './performAction.js';
import type { StepContext, StepPosition } from './StepContext.js';
import type { StepOutcome } from './StepOutcome.js';
import type { StepRunResult } from './StepRunResult.js';
import { logCheckpoint, verifyCheckpoint } from './verifyCheckpoint.js';

export type { StepRunResult } from './StepRunResult.js';

/** The condition rules the runner resolves per step (artifact rule → app profile → catalog default). */
export type ConditionSources = Omit<RuleSources, 'stepId'> & {
	/** The app profile's known dialogs: recoverable, settled as configured (step 38). */
	readonly knownDialogs?: readonly KnownDialog[];
};

/** The condition rules and the escalation seam of a `StepRunner`; both optional (unit tests omit them). */
export interface StepRunnerOptions {
	/**
	 * The runtime-condition rules (steps 35+). Omitted: no pre-step observation and one bounded check per
	 * checkpoint; only engine-detected conditions (a pending dialog, a slow load) can occur, classified by the
	 * catalog.
	 */
	readonly conditions?: ConditionSources;
	/**
	 * The live session's approval and escalation (step 34). Omitted: an irreversible step without a grant fails
	 * with `approval_required` and no request, and hard failures do not escalate (unit tests).
	 */
	readonly escalation?: EscalationSession;
}

/** A step's context with its condition watch (the detectors for that step's rules). */
interface Scoped {
	readonly context: StepContext;
	readonly watch: ConditionWatch | null;
}

/** Where a condition is being settled: a step (or the success condition, `step` null) and its budgets. */
interface SettleScope {
	readonly step: Step | null;
	readonly position: StepPosition | null;
	readonly lastStepId: string;
	readonly scoped: Scoped;
	readonly recovery: StepRecovery;
	/** `before`: seen before the action (the action still runs); `after`: seen instead of the checkpoint. */
	readonly phase: 'before' | 'after';
	/** Verifies the checkpoint again after an in-place recovery (a settled dialog). */
	readonly reverify: () => Promise<StepOutcome>;
}

/** How settling a step's conditions ended. */
type Settled =
	| { readonly kind: 'resolved' }
	/** A retry or re-auth re-established the screen before the step: run the step again. */
	| { readonly kind: 'restart' }
	| { readonly kind: 'outcome'; readonly result: StepRunResult };

/** A retry's or re-auth's re-run: run the step again, or settle what the re-run showed. */
type Rerun = { readonly kind: 'restart' } | { readonly kind: 'settle'; readonly outcome: StepOutcome };

const COMPLETED: StepRunResult = { kind: 'completed' };
const RESOLVED: Settled = { kind: 'resolved' };
const RESTART = { kind: 'restart' } as const;

/** Runs one step with its handler (exhaustive over the Step union). */
function dispatch(step: Step, position: StepPosition, context: StepContext): Promise<StepOutcome> {
	switch (step.kind) {
		case 'navigate':
			return runNavigate(step, position, context);
		case 'click':
			return runClick(step, position, context);
		case 'fill':
			return runFill(step, position, context);
		case 'select':
			return runSelect(step, position, context);
		case 'press':
			return runPress(step, position, context);
		case 'extract':
			return runExtract(step, position, context);
		case 'wait':
			return runWait(step, position, context);
		case 'dismiss_dialog':
			return runDismissDialog(step, position, context);
		default: {
			const unreachable: never = step;
			throw new ReplayError('artifact_invalid', {
				step: position,
				expected: 'a registered step kind',
				observed: `kind ${String((unreachable as { kind?: unknown }).kind)}`,
			});
		}
	}
}

function exhausted(position: StepPosition | null, expected: string, observed: string): ReplayError {
	return new ReplayError('recovery_exhausted', { step: position, expected, observed });
}

/**
 * The per-step loop. For each step: (1) pre-observe — a pending native dialog, or (with rules) a runtime condition
 * already on screen; (2) run the handler (bind, act through the guarded surface, log); (3) the post-step
 * checkpoint (inside the handler), raced against the step's condition detectors; (4) settle a detected condition
 * by its resolved class: a business outcome ends the steps; a recoverable one gets its bounded recovery (settle a
 * known dialog, wait for a slow load, retry after a failed load, re-authenticate after a session timeout), each
 * attempt logged; a failure is thrown. An irreversible step refused for lack of a grant goes through the approval
 * gate; an escalating hard failure goes to a human once per step (step 34). Surface errors become `ReplayError`s
 * (`toReplayError`); an unknown error is a bug and is rethrown. No model anywhere (invariant 1).
 */
export class StepRunner {
	private steps: readonly Step[] = [];

	constructor(
		private readonly context: StepContext,
		private readonly options: StepRunnerOptions = {},
	) {}

	async run(steps: readonly Step[]): Promise<StepRunResult> {
		this.steps = steps;
		for (const [index, step] of steps.entries()) {
			const result = await this.runWithEscalation(step, { index, id: step.id });
			if (result.kind !== 'completed') return result;
		}
		return COMPLETED;
	}

	/**
	 * The artifact's success condition, after the last step, with the `any_step` rules watching (a business outcome
	 * found here is attributed to the last step). Not held → `checkpoint_failed` outside any step (no escalation).
	 * Only a known dialog can be recovered here: there is no step to retry or re-run.
	 */
	async verifySuccessCondition(checkpoint: Checkpoint, lastStepId: string): Promise<StepRunResult> {
		const scoped = this.scoped(null);
		const reverify = () => verifyCheckpoint(checkpoint, null, scoped.context);
		const settled = await this.settle(await reverify(), {
			step: null,
			position: null,
			lastStepId,
			scoped,
			recovery: new StepRecovery(),
			phase: 'after',
			reverify,
		});
		return settled.kind === 'outcome' ? settled.result : COMPLETED;
	}

	private async runWithEscalation(step: Step, position: StepPosition): Promise<StepRunResult> {
		const scoped = this.scoped(step.id);
		const recovery = new StepRecovery();
		try {
			return await this.attempt(step, position, scoped, recovery);
		} catch (error) {
			const session = this.options.escalation;
			if (!(error instanceof ReplayError) || session === undefined || !shouldEscalate(error.code)) throw error;
			const resumed = await handleHardFailure({
				error,
				step,
				position,
				context: scoped.context,
				session,
				rerun: () => this.runStep(step, position, scoped.context),
			});
			// Bounded: a failure while settling what the operator left is not escalated again.
			return this.attempt(step, position, scoped, recovery, resumed);
		}
	}

	/**
	 * One step, until it completes, ends in a business outcome, or fails. A retry or re-auth restarts it (each
	 * bounded by its budget). `initial`: the step already ran (a takeover) and this is its checkpoint's outcome.
	 */
	private async attempt(
		step: Step,
		position: StepPosition,
		scoped: Scoped,
		recovery: StepRecovery,
		initial?: StepOutcome,
	): Promise<StepRunResult> {
		const scope = (phase: SettleScope['phase']): SettleScope => ({
			step,
			position,
			lastStepId: step.id,
			scoped,
			recovery,
			phase,
			reverify: () => verifyCheckpoint(step.checkpoint, position, scoped.context),
		});
		try {
			if (initial === undefined) await this.recordCheckpointBefore(step, scoped, recovery);
			let next = initial;
			for (;;) {
				let settled: Settled;
				if (next !== undefined) {
					settled = await this.settle(next, scope('after'));
					next = undefined;
				} else {
					const before = await this.preObserve(step, scoped);
					if (before !== null) {
						const cleared = await this.settle(before, scope('before'));
						if (cleared.kind === 'outcome') return cleared.result;
						if (cleared.kind === 'restart') continue;
					}
					settled = await this.settle(await this.runStep(step, position, scoped.context), scope('after'));
				}
				if (settled.kind === 'outcome') return settled.result;
				if (settled.kind === 'resolved') return COMPLETED;
			}
		} catch (error) {
			this.closePending(recovery, 'failed', scoped.context);
			throw error;
		}
	}

	/**
	 * Settles a step outcome: while it is a condition, respond to it (`respondToCondition`) and run the recovery the
	 * reply asks for. Every loop consumes a bounded budget (dismissals and retries per step, re-auths per run, one
	 * slow-load wait), so it ends.
	 */
	private async settle(first: StepOutcome, scope: SettleScope): Promise<Settled> {
		let current = first;
		while (current.kind === 'condition') {
			// A slow load has not finished yet: the retry or re-auth that led to it is judged when it does.
			if (current.code !== 'slow_load') {
				this.closePending(scope.recovery, current.code, scope.scoped.context);
			}
			const reply = await this.consult(current, scope);
			if (reply.kind === 'outcome') return { kind: 'outcome', result: reply.result };
			const { plan, condition } = reply;
			const at = current.at ?? scope.position;
			if (current.during !== undefined && (plan.kind === 'dismiss_dialog' || plan.kind === 'wait')) {
				throw exhausted(
					at,
					`${condition.code} to be recoverable in place`,
					`${condition.code} showed during the ${current.during} of ${scope.position?.id ?? 'the run'}; in-place recoveries are not nested`,
				);
			}
			switch (plan.kind) {
				case 'dismiss_dialog':
					await dismissKnownDialog({
						condition,
						plan,
						position: at,
						context: scope.scoped.context,
						recovery: scope.recovery,
					});
					current =
						scope.phase === 'after'
							? await scope.reverify()
							: ((await this.preObserve(scope.step, scope.scoped)) ?? { kind: 'completed' });
					break;
				case 'wait': {
					const checkpoint = scope.step?.checkpoint;
					if (scope.position === null || checkpoint === undefined || current.startedAt === undefined) {
						throw exhausted(at, 'a step checkpoint to wait for', `${condition.code} outside a step with a checkpoint`);
					}
					current = await waitForSlowLoad({
						checkpoint,
						position: scope.position,
						context: scope.scoped.context,
						startedAt: current.startedAt,
					});
					break;
				}
				case 'retry':
				case 'reauth': {
					const rerun =
						plan.kind === 'retry' ? await this.retry(condition, plan, scope) : await this.reauth(condition, scope);
					if (rerun.kind === 'restart') return RESTART;
					current = rerun.outcome;
					break;
				}
			}
		}
		this.closePending(scope.recovery, 'succeeded', scope.scoped.context);
		return RESOLVED;
	}

	/**
	 * Logs the outcome of the pending retry or re-auth, if any: given a condition code, `failed` when it is the same
	 * condition again, else `succeeded` (the recovery cleared it; something else showed).
	 */
	private closePending(recovery: StepRecovery, outcomeOrCode: string, context: StepContext): void {
		const pending = recovery.pending;
		if (pending === null) return;
		recovery.pending = null;
		const outcome =
			outcomeOrCode === 'succeeded' || outcomeOrCode === 'failed'
				? outcomeOrCode
				: outcomeOrCode === pending.code
					? 'failed'
					: 'succeeded';
		logRecovery({ ...pending, outcome }, context);
	}

	/**
	 * Classifies a condition (artifact rule → app profile → catalog default) and responds to it. A signature
	 * condition carries its rule (from the watch that saw it); an engine-detected one (an unrecognised dialog, a
	 * slow load, a load past its budget) is resolved by code. A code nobody knows fails loudly: never a guessed class.
	 */
	private async consult(
		outcome: Extract<StepOutcome, { kind: 'condition' }>,
		scope: SettleScope,
	): Promise<ConditionReply> {
		const position = outcome.at ?? scope.position;
		const engine = outcome.detail !== undefined || outcome.code === UNKNOWN_DIALOG;
		const match = engine ? null : (outcome.match ?? scope.scoped.watch?.matchFor(outcome.code) ?? null);
		const detail = outcome.detail ?? (outcome.code === UNKNOWN_DIALOG ? this.unknownDialogDetail() : undefined);
		const sources = this.options.conditions;
		const condition = classifyCondition({
			code: outcome.code,
			match,
			sources: {
				artifactRules: sources?.artifactRules ?? [],
				profileRules: sources?.profileRules ?? [],
				stepId: position?.id ?? null,
			},
			...(detail === undefined ? {} : { detail }),
		});
		if (condition === null) {
			throw new ReplayError('checkpoint_failed', {
				step: position,
				expected: 'a detected condition to match a resolved rule',
				observed: `runtime condition "${outcome.code}" has no rule at this step`,
			});
		}
		return respondToCondition(condition, position, scope.lastStepId, scope.scoped.context);
	}

	/** The pending dialog's type only: its message may carry app data and never goes into a result. */
	private unknownDialogDetail(): string {
		const dialog = this.context.surface.pendingDialog();
		return dialog === null
			? 'a native dialog no rule recognises'
			: `a native ${dialog.type} dialog no rule recognises is pending; it is left unaccepted`;
	}

	/**
	 * Failed load (step 40): after the backoff, reload from the artifact's entry route and run the step again —
	 * at most `max` times per step (the rule's retry, capped by `ReplayOptions.retry`). Never for an irreversible
	 * step, and never re-running an irreversible step before it.
	 */
	private async retry(
		condition: DetectedCondition,
		plan: Extract<RecoveryPlan, { kind: 'retry' }>,
		scope: SettleScope,
	): Promise<Rerun> {
		const { step, position, recovery } = scope;
		if (step === null || position === null) {
			throw exhausted(null, 'a step to retry', `${condition.code} at the success condition: there is no step to retry`);
		}
		if (this.riskOf(step) === 'irreversible') {
			throw exhausted(
				position,
				`${step.id} to load`,
				`${condition.code} after an irreversible step: it is never retried`,
			);
		}
		if (recovery.retries >= plan.max) {
			throw exhausted(
				position,
				`${step.id} to load within ${plan.max} retries`,
				`${condition.code} (${condition.source}) persisted after ${recovery.retries} retries: ${condition.signal}`,
			);
		}
		const prefix = this.prefixOf(position, step.phase === 'login' ? 1 : this.firstMainIndex());
		const irreversible = prefix.find((index) => {
			const prior = this.steps[index];
			return prior !== undefined && this.riskOf(prior) === 'irreversible';
		});
		if (irreversible !== undefined) {
			throw exhausted(
				position,
				`${step.id} to load`,
				`retrying would re-run the irreversible ${this.steps[irreversible]?.id ?? 'step'}: refused`,
			);
		}
		recovery.retries += 1;
		recovery.pending = {
			code: condition.code,
			recoveryKind: 'retry',
			attempt: recovery.retries,
			budget: plan.max,
			stepId: step.id,
		};
		await (this.context.sleep ?? sleep)(plan.backoffMs);
		if (position.index === 0) return RESTART; // the failed step is the entry navigation itself
		return this.reload(step, position, scope.scoped, recovery, prefix);
	}

	/**
	 * Reloads the artifact's entry route (its first step, a navigate, through the guarded surface — its checkpoint is
	 * not the target of a reload: the session may already be signed on). Then, from what the reload shows: the
	 * step's own checkpoint already holds (e.g. a sign-on whose landing page failed) → done, but only when that
	 * proves the step took effect — the checkpoint did not hold before the step was first attempted, or the step is
	 * read-only (not an extract, whose read would be lost); a condition → settle it; otherwise re-run the steps
	 * between the entry and the failed one, then the step itself.
	 */
	private async reload(
		step: Step,
		position: StepPosition,
		scoped: Scoped,
		recovery: StepRecovery,
		prefix: readonly number[],
	): Promise<Rerun> {
		const entry = this.steps[0];
		if (entry?.kind !== 'navigate') {
			throw exhausted(
				position,
				'an entry navigation to reload from',
				'the artifact does not start with a navigate step',
			);
		}
		const { context } = scoped;
		try {
			await performRecoveryAction(
				{
					kind: 'navigate',
					actor: 'replay',
					stepId: step.id,
					bindings: context.binder.bindings,
					timeoutMs: entry.timeoutMs ?? context.options.stepTimeoutMs,
					route: entry.route,
				},
				position,
				context,
			);
		} catch (error) {
			throw recoveryFailure(error, `reloading the entry route for ${step.id}`, position) ?? error;
		}
		if (step.checkpoint !== undefined) {
			const verdict = await context.verifier.verify(step.checkpoint, context.binder.bindings, 1);
			const provesDone =
				recovery.checkpointHeldBefore === false || (this.riskOf(step) === 'read' && step.kind !== 'extract');
			if (verdict.kind === 'condition' || (verdict.kind === 'held' && provesDone)) {
				logCheckpoint(step.checkpoint, position, verdict, context);
				return {
					kind: 'settle',
					outcome:
						verdict.kind === 'held'
							? { kind: 'completed' }
							: { kind: 'condition', code: verdict.code, during: 'retry' },
				};
			}
		} else if (scoped.watch !== null) {
			const code = scoped.watch.detect(await context.surface.observe());
			if (code !== null) return { kind: 'settle', outcome: { kind: 'condition', code, during: 'retry' } };
		}
		return this.rerun(prefix, 'retry');
	}

	/**
	 * Session timeout (step 41): re-run the login-phase steps, then the main steps up to the failed one, then the
	 * step itself — at most `maxReauthPerRun` times per run. If an irreversible step already ran, the session is
	 * lost instead (re-running it could repeat its effect). Exhausted → `session_lost`.
	 */
	private async reauth(condition: DetectedCondition, scope: SettleScope): Promise<Rerun> {
		const { step, position } = scope;
		const max = this.context.options.maxReauthPerRun;
		const state = this.context.state;
		const lost = (expected: string, observed: string) =>
			new ReplayError('session_lost', { step: position, expected, observed });
		if (step === null || position === null) {
			throw lost('a step to resume after re-authenticating', `${condition.code} at the success condition`);
		}
		if (state.reauths >= max) {
			throw lost(
				`the session to hold with at most ${max} re-auth(s) per run`,
				`${condition.code} (${condition.source}) after ${state.reauths} re-auth(s): ${condition.signal}`,
			);
		}
		const ran = this.steps.slice(0, position.index + 1).find((candidate) => this.riskOf(candidate) === 'irreversible');
		if (ran !== undefined) {
			throw lost(
				`a session that can be re-established by re-running ${step.id}'s prefix`,
				`${condition.code}: the irreversible ${ran.id} already ran and is never re-run`,
			);
		}
		state.reauths += 1;
		scope.recovery.pending = {
			code: condition.code,
			recoveryKind: 'reauth',
			attempt: state.reauths,
			budget: max,
			stepId: step.id,
		};
		const login = this.prefixOf(position, 0).filter((index) => this.steps[index]?.phase === 'login');
		const main = step.phase === 'main' ? this.prefixOf(position, this.firstMainIndex()) : [];
		return this.rerun([...login, ...main.filter((index) => !login.includes(index))], 'reauth');
	}

	/** Runs earlier steps again (handler, checkpoint and detectors; no pre-observe): restart, or what they showed. */
	private async rerun(indices: readonly number[], during: 'retry' | 'reauth'): Promise<Rerun> {
		for (const index of indices) {
			const prior = this.steps[index];
			if (prior === undefined) continue;
			const at = { index, id: prior.id };
			const scoped = this.scoped(prior.id);
			const outcome = await this.runStep(prior, at, scoped.context);
			if (outcome.kind === 'condition') {
				const match = outcome.detail === undefined ? scoped.watch?.matchFor(outcome.code) : undefined;
				return {
					kind: 'settle',
					outcome: { ...outcome, during, at, ...(match === undefined || match === null ? {} : { match }) },
				};
			}
		}
		return RESTART;
	}

	/**
	 * Records whether the step's checkpoint already holds before the step is first attempted (one evaluation, no
	 * detectors, not logged). Only with condition rules (they bring the failed-load retry that reads it) and only
	 * once per step; unrecorded, a retry's reload never counts the step as done by its checkpoint alone.
	 */
	private async recordCheckpointBefore(step: Step, scoped: Scoped, recovery: StepRecovery): Promise<void> {
		if (step.checkpoint === undefined || scoped.watch === null || recovery.checkpointHeldBefore !== null) return;
		const { surface, binder } = scoped.context;
		recovery.checkpointHeldBefore = (await surface.check(step.checkpoint, binder.bindings, 1)).kind === 'held';
	}

	/** The step's effective risk: declared, raised to what the policy guard classified when it acted. */
	private riskOf(step: Step): RiskClass {
		return effectiveRisk(step, this.context);
	}

	/** Indices from `from` up to (not including) the step at `position`. */
	private prefixOf(position: StepPosition, from: number): number[] {
		const indices: number[] = [];
		for (let index = Math.max(0, from); index < position.index; index += 1) indices.push(index);
		return indices;
	}

	private firstMainIndex(): number {
		const index = this.steps.findIndex((step) => step.phase === 'main');
		return index === -1 ? this.steps.length : index;
	}

	/**
	 * The context and detectors for a step (`null`: the success condition): the artifact's rules in scope, the
	 * profile's, and the profile's known dialogs. Without condition sources, the plain context (no extra observation).
	 */
	private scoped(stepId: string | null): Scoped {
		const sources = this.options.conditions;
		if (sources === undefined) return { context: this.context, watch: null };
		const rules = [
			...resolveRules({ artifactRules: sources.artifactRules, profileRules: sources.profileRules, stepId }),
			...knownDialogRules(sources.knownDialogs ?? []),
		];
		const watch = new ConditionWatch(rules);
		const verifier = new CheckpointVerifier({ surface: this.context.surface, detect: watch.detect });
		return { context: { ...this.context, verifier }, watch };
	}

	private async runStep(step: Step, position: StepPosition, context: StepContext): Promise<StepOutcome> {
		try {
			return await dispatch(step, position, context);
		} catch (error) {
			if (!(error instanceof ApprovalRequiredError)) throw this.mapped(error, step, position);
			const session = this.options.escalation;
			if (session === undefined) throw this.approvalRequired(error, position);
			try {
				return await handleApproval({
					error,
					step,
					position,
					context,
					session,
					retry: (grant) => dispatch(step, position, { ...context, approvalGrant: grant }),
				});
			} catch (approvalError) {
				throw this.mapped(approvalError, step, position);
			}
		}
	}

	/** A surface or session error as the run failure it ends with; an unknown error is a bug and is returned as is. */
	private mapped(error: unknown, step: Step, position: StepPosition): unknown {
		return toReplayError(error, step, position.index) ?? error;
	}

	/**
	 * Before acting: a pending native dialog (only a `dismiss_dialog` step may run then — it settles the dialog it
	 * expects), or, with rules, a runtime condition already on screen. `step` null (the success condition): the
	 * screen only.
	 */
	private async preObserve(step: Step | null, scoped: Scoped): Promise<StepOutcome | null> {
		const dialog = this.context.surface.pendingDialog();
		if (dialog !== null && step?.kind === 'dismiss_dialog') return null;
		if (scoped.watch === null) return dialog === null ? null : { kind: 'condition', code: UNKNOWN_DIALOG };
		const code = scoped.watch.detect(await this.context.surface.observe());
		return code === null ? null : { kind: 'condition', code };
	}

	/** Without a session (unit tests): an irreversible step without a grant fails with `approval_required`. */
	private approvalRequired(error: ApprovalRequiredError, position: StepPosition): ReplayError {
		return new ReplayError('approval_required', {
			step: position,
			expected: 'an approval for the irreversible step',
			observed: `${error.actionKind} requires approval and none was granted`,
			cause: error,
		});
	}
}
