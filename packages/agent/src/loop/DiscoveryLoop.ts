import type { Checkpoint, InterventionId, RunLogEntryInput } from '@idp/artifact-schema';
import { systemClock, type Clock } from '@idp/evidence';
import { classifyRisk, FULL_MASK, type Redactor, type ResolvedPolicy } from '@idp/policy';
import type { SessionHumanAction } from '@idp/session';
import {
	ActionFailedError,
	ApprovalRequiredError,
	BindingMissingError,
	DialogMismatchError,
	DialogPendingError,
	fingerprintKey,
	FrameNotFoundError,
	NavigationBlockedError,
	NoDialogPendingError,
	OptionNotFoundError,
	PolicyDeniedError,
	TargetNotResolvedError,
	UnknownRefError,
	WaitTimeoutError,
	type ActOutcome,
	type ApprovalGrant,
	type ElementFingerprint,
	type Observation,
	type SurfaceAction,
} from '@idp/surface';
import { buildLocatorLadder } from '../compiler/buildLocatorLadder.js';
import { createTextGuard } from '../compiler/TextGuard.js';
import { DiscoveryConfigError } from '../errors/DiscoveryConfigError.js';
import { ToolCallError } from '../errors/ToolCallError.js';
import { UnlocatableTargetError } from '../errors/UnlocatableTargetError.js';
import type { ModelClient, ModelRequest } from '../model/ModelClient.js';
import type { ModelMessage, ModelToolCall, ModelUserContent } from '../model/ModelMessage.js';
import { formatObservation } from '../observe/formatObservation.js';
import { buildSystemPrompt } from '../prompt/systemPrompt.js';
import type { CheckpointProposal } from '../tools/CheckpointProposal.js';
import { agentToolSpecs } from '../tools/toolDefinitions.js';
import type { ToolDecision } from '../tools/ToolDecision.js';
import { toolToAction, type ToolCallContext } from '../tools/toolToAction.js';
import { computeScreenDiff } from '../trace/computeScreenDiff.js';
import type { DeclaredOutput, DiscoveryTrace, TraceAction, TraceStep, TraceValue } from '../trace/DiscoveryTrace.js';
import { safeFingerprint } from '../trace/safeFingerprint.js';
import type { ScreenDiff } from '../trace/ScreenDiff.js';
import type { DiscoveryOutcome, StopReason } from './DiscoveryOutcome.js';
import type { DiscoverySession } from './DiscoverySession.js';
import { StopConditions, type StopOptions } from './StopConditions.js';

/** A capability input of the discovery run. */
export interface DiscoveryParam {
	readonly name: string;
	readonly description?: string;
	/** Default true. */
	readonly sensitive?: boolean;
}

/** Budgets (see `StopOptions`), the clock of the time budget, and the finish-verification timeout. */
export interface DiscoveryLoopOptions extends Partial<StopOptions> {
	/** The clock of the time budget and of log timestamps (a FakeClock in tests). */
	readonly clock?: Clock;
	/** How long a `finish` checkpoint may take to hold. Default 5000 ms. */
	readonly verifyTimeoutMs?: number;
}

/** Everything one discovery loop needs: goal, example inputs, credentials, the live session, the model and the redactor. */
export interface DiscoveryLoopInput {
	/** The natural-language goal; placeholderized before the model sees it. */
	readonly goal: string;
	/**
	 * The entry route (e.g. the profile's `loginRoute`). When set, the loop navigates there itself before the
	 * first observation, recorded as a `navigate` trace step by the agent, so the model starts on the app.
	 */
	readonly target?: string;
	/** The example inputs by param name: the values behind `{{name}}`. Never shown to the model. */
	readonly exampleInputs: Readonly<Record<string, string>>;
	/** Descriptions and sensitivity of the params; default: every example input, sensitive. */
	readonly params?: readonly DiscoveryParam[];
	/** The sign-on credential behind `{{credential.username}}` / `{{credential.password}}`. */
	readonly credentials?: { readonly username: string; readonly password: string };
	readonly session: DiscoverySession;
	readonly model: ModelClient;
	/** Must know every example input (with its param name) and credential value (see `createRedactor`). */
	readonly redactor: Redactor;
	readonly policy: ResolvedPolicy;
	readonly options?: DiscoveryLoopOptions;
}

interface Stop {
	readonly stop: StopReason;
	readonly detail: string;
	readonly requestId?: InterventionId;
}
/** What a handled turn tells the model, or a stop. */
type TurnResult = { readonly content: string; readonly isError: boolean } | Stop;

const DEFAULT_VERIFY_TIMEOUT_MS = 5_000;
const LOOP_NAVIGATE_REASON = 'Open the target entry page before the first observation (the loop does this itself).';
const HUMAN_REASON = 'Recorded from the operator during a handoff.';
const TOOL_NAME = /^[a-z][a-z0-9_]*$/;

/** Errors of a single action that go back to the model as a tool error (they count toward the budget). */
const FEEDBACK_ERRORS = [
	UnknownRefError,
	TargetNotResolvedError,
	ActionFailedError,
	OptionNotFoundError,
	WaitTimeoutError,
	DialogPendingError,
	NoDialogPendingError,
	DialogMismatchError,
	FrameNotFoundError,
	BindingMissingError,
	UnlocatableTargetError,
] as const;
const isFeedbackError = (error: unknown): error is Error & { code: string } =>
	FEEDBACK_ERRORS.some((type) => error instanceof type);
const isDenial = (error: unknown): error is PolicyDeniedError | NavigationBlockedError =>
	error instanceof PolicyDeniedError || error instanceof NavigationBlockedError;

const isStop = (result: TurnResult | { readonly note: string }): result is Stop => 'stop' in result;

function traceValue(source: ToolDecision & { kind: 'action' }, literal: string): TraceValue {
	const valueSource = source.valueSource ?? { kind: 'literal' };
	if (valueSource.kind === 'param') return { kind: 'param', name: valueSource.name };
	if (valueSource.kind === 'credential') return { kind: 'credential', field: valueSource.field };
	return { kind: 'literal', value: literal };
}

function traceActionOf(decision: ToolDecision & { kind: 'action' }): TraceAction {
	const action = decision.action;
	switch (action.kind) {
		case 'navigate':
			return { kind: 'navigate', route: action.route };
		case 'click':
			return { kind: 'click' };
		case 'fill':
			return { kind: 'fill', value: traceValue(decision, action.value), sensitive: action.sensitive };
		case 'select':
			return { kind: 'select', option: traceValue(decision, action.option) };
		case 'press':
			return { kind: 'press', key: action.key };
		case 'extract':
			return { kind: 'extract', output: decision.output ?? '' };
		case 'wait':
			return { kind: 'wait', until: action.until, timeoutMs: action.timeoutMs };
		case 'dismiss_dialog':
			return { kind: 'dismiss_dialog', match: action.match, action: action.action };
	}
}

function proposalToCheckpoint(proposal: CheckpointProposal & { kind: 'text' }): Checkpoint {
	return {
		kind: 'text_present',
		text: proposal.text,
		...(proposal.frame === undefined ? {} : { frame: proposal.frame.map((name) => ({ kind: 'by_name', name })) }),
	};
}

/**
 * The LLM discovery loop (R1, FR4): observe → placeholderize/redact → model → policy (inside the guarded
 * surface) → act → record a `TraceStep`, until the model finishes with a checkpoint that holds on screen or a
 * stop condition trips (`StopConditions`). See `DiscoveryOutcome` for the stop reasons.
 *
 * - **Entry.** With `target`, the loop navigates there itself before the first observation (a `navigate` trace
 *   step, actor `agent`), so the model starts on the app instead of a blank page.
 * - **Turns.** One tool call is acted on per turn (extra calls get an error result). Unknown tools, invalid
 *   input, policy denials and resolution errors go back to the model as error tool results and count toward
 *   the step budget. Each call is logged as a `decision` with the model's reason; each action as an `action`.
 * - **Irreversible actions.** `ApprovalRequiredError` → `session.requestApproval` bound to the target's
 *   `fingerprintKey`; granted → act once with the grant; rejected or aborted → stopped `human_aborted`;
 *   unattended or timed out → stopped `policy_blocked` (the action cannot happen without a human).
 * - **Help.** A dead end or `request_help` calls `session.escalate` (unattended, the request is still raised
 *   and persisted). Resumed → the recorded human actions join the trace (actor `human`), the loop re-observes,
 *   reacquires the lease and continues; aborted → `human_aborted`; otherwise `dead_end` / `model_gave_up`.
 * - **Model gives up.** A turn without a tool call stops with `model_gave_up`.
 * - **Redaction.** The model sees only placeholderized, redacted text. Each request is written to
 *   `prompts/turn-NN.json` when the run ends, redacted again with every value known by then (extracted values
 *   become known only when read), so no prompt file holds a value the run learned later (invariant 3).
 */
export class DiscoveryLoop {
	readonly #input: DiscoveryLoopInput;
	readonly #clock: Clock;
	readonly #stops: StopConditions;
	readonly #params: readonly DiscoveryParam[];
	readonly #verifyTimeoutMs: number;
	readonly #context: ToolCallContext;
	readonly #steps: TraceStep[] = [];
	readonly #outputs = new Map<string, DeclaredOutput>();
	readonly #extracted: Record<string, string> = {};
	readonly #requests: ModelRequest[] = [];
	readonly #messages: ModelMessage[] = [];
	#observation!: Observation;
	#finish: DiscoveryTrace['finish'] = null;

	private constructor(input: DiscoveryLoopInput) {
		this.#input = input;
		const { clock, verifyTimeoutMs, ...stopOptions } = input.options ?? {};
		this.#verifyTimeoutMs = verifyTimeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
		this.#clock = clock ?? systemClock;
		this.#stops = new StopConditions({ ...stopOptions, clock: this.#clock });
		const params: readonly DiscoveryParam[] =
			input.params ?? Object.keys(input.exampleInputs).map((name) => ({ name }));
		this.#params = params;
		for (const param of params) {
			if (!Object.hasOwn(input.exampleInputs, param.name)) {
				throw new DiscoveryConfigError('exampleInputs', `no example input for param "${param.name}"`);
			}
		}
		this.#context = {
			params: { ...input.exampleInputs },
			sensitiveParams: new Set(params.filter((param) => param.sensitive !== false).map((param) => param.name)),
			...(input.credentials === undefined ? {} : { credentials: input.credentials }),
		};
	}

	/** Runs one discovery loop on an open session. Never compiles: see `DiscoveryRunner`. */
	static run(input: DiscoveryLoopInput): Promise<DiscoveryOutcome> {
		return new DiscoveryLoop(input).#run();
	}

	async #run(): Promise<DiscoveryOutcome> {
		let outcome: DiscoveryOutcome;
		try {
			outcome = await this.#loop();
		} catch (error) {
			try {
				await this.#flushPrompts();
			} catch (flushError) {
				throw new AggregateError([error, flushError], 'discovery failed and its prompts could not be written', {
					cause: flushError,
				});
			}
			throw error;
		}
		await this.#flushPrompts();
		return outcome;
	}

	async #loop(): Promise<DiscoveryOutcome> {
		const input = this.#input;
		const system = buildSystemPrompt({
			goal: input.goal,
			params: this.#params.map((param) => ({
				name: param.name,
				...(param.description === undefined ? {} : { description: param.description }),
			})),
			credentials: input.credentials !== undefined,
			redactor: input.redactor,
		});
		const tools = agentToolSpecs();

		this.#observation = await this.#observe();
		let opening = 'Begin. This is the current screen.';
		if (input.target !== undefined) {
			const decision: ToolDecision & { kind: 'action' } = {
				kind: 'action',
				reason: LOOP_NAVIGATE_REASON,
				action: { kind: 'navigate', actor: 'agent', route: input.target, bindings: { ...input.exampleInputs } },
			};
			const result = await this.#performAction(decision);
			if (isStop(result)) return this.#stopped(result);
			if (result.isError) {
				const refused = this.#steps.at(-1)?.verdict === 'refused';
				return this.#stopped({
					stop: refused ? 'policy_blocked' : 'dead_end',
					detail: `entry page: ${result.content}`,
				});
			}
			opening = `Begin. The application entry page ${input.target} is open.`;
		}
		this.#messages.push({
			role: 'user',
			content: [{ kind: 'text', text: `${opening}\n\n${this.#render(this.#observation)}` }],
		});

		for (;;) {
			const budget = this.#stops.beforeTurn();
			if (budget !== null) return this.#stopped({ stop: budget, detail: this.#budgetDetail(budget) });

			const request: ModelRequest = { system, messages: structuredClone(this.#messages), tools };
			this.#requests.push(request);
			const turn = await input.model.next(request);
			this.#stops.countTurn();
			this.#messages.push({
				role: 'assistant',
				text: input.redactor.placeholderize(turn.text),
				toolCalls: turn.toolCalls,
				...(turn.providerContent === undefined ? {} : { providerContent: turn.providerContent }),
			});
			const [call, ...extra] = turn.toolCalls;
			if (call === undefined) {
				return this.#stopped({
					stop: 'model_gave_up',
					detail: `the model ended its turn without a tool call (${turn.stopReason})`,
				});
			}
			this.#logDecision(call, turn.text);

			const result = await this.#handle(call);
			if (isStop(result)) return this.#stopped(result);
			if (this.#finish !== null) {
				return {
					kind: 'goal_met',
					trace: this.#trace(),
					finalCheckpoint: this.#finish.finalCheckpoint,
					summary: this.#finish.summary,
					extracted: { ...this.#extracted },
					turns: this.#stops.turns,
				};
			}
			const content: ModelUserContent[] = [
				{
					kind: 'tool_result',
					toolCallId: call.id,
					content: `${input.redactor.placeholderize(result.content)}\n\n${this.#render(this.#observation)}`,
					isError: result.isError,
				},
				...extra.map((ignored): ModelUserContent => ({
					kind: 'tool_result',
					toolCallId: ignored.id,
					content: 'Ignored: call exactly one tool per turn.',
					isError: true,
				})),
			];
			this.#messages.push({ role: 'user', content });
		}
	}

	/** Handles one tool call; `#observation` is the screen the model saw and is refreshed after an action. */
	async #handle(call: ModelToolCall): Promise<TurnResult> {
		let decision: ToolDecision;
		try {
			decision = toolToAction(call, this.#context);
		} catch (error) {
			if (error instanceof ToolCallError) return { content: `Error (${error.code}): ${error.message}`, isError: true };
			throw error;
		}
		switch (decision.kind) {
			case 'declare_output': {
				const previous = this.#outputs.get(decision.output.name);
				this.#outputs.set(decision.output.name, decision.output);
				if (previous === undefined || JSON.stringify(previous) !== JSON.stringify(decision.output)) {
					this.#stops.recordProgress();
				}
				return { content: `Declared output ${decision.output.name}.`, isError: false };
			}
			case 'request_help':
				return this.#askForHelp('model_gave_up', 'agent_request_help', `The agent asked for help: ${decision.reason}`);
			case 'finish':
				return this.#verifyFinish(decision);
			case 'action': {
				if (decision.action.kind === 'extract' && !this.#outputs.has(decision.output ?? '')) {
					return {
						content: `Error: output "${decision.output ?? ''}" is not declared; call declare_output first.`,
						isError: true,
					};
				}
				return this.#performAction(decision);
			}
		}
	}

	async #performAction(decision: ToolDecision & { kind: 'action' }): Promise<TurnResult> {
		const { redactor } = this.#input;
		const before = this.#observation;
		const action = decision.action;
		const target = 'target' in action ? action.target : undefined;
		let fingerprint: ElementFingerprint | null = null;
		const base = () => ({
			actor: 'agent' as const,
			action: traceActionOf(decision),
			reason: redactor.placeholderize(decision.reason),
			pageRoute: this.#pageRoute(before, fingerprint),
			digestBefore: before.digest,
		});
		const started = this.#clock.now().getTime();
		let outcome: ActOutcome;
		let approved = false;
		try {
			// Refs are valid for the observation they came from: fingerprint before acting.
			if (target !== undefined) fingerprint = await this.#input.session.surface.describe(target);
			try {
				outcome = await this.#input.session.surface.act(action);
			} catch (error) {
				if (!(error instanceof ApprovalRequiredError)) throw error;
				const approval = await this.#requestApproval(action, error.fingerprint ?? fingerprint);
				if ('stop' in approval) {
					this.#record({ ...base(), fingerprint: this.#safe(fingerprint), verdict: 'refused', errorCode: error.code });
					return approval;
				}
				approved = true;
				outcome = await this.#input.session.surface.act({ ...action, approvalGrant: approval.grant });
			}
		} catch (error) {
			if (isDenial(error)) {
				this.#record({ ...base(), fingerprint: this.#safe(fingerprint), verdict: 'refused', errorCode: error.code });
				const stop = this.#stops.recordDenial();
				const detail = `${action.kind} denied by policy (${error instanceof PolicyDeniedError ? error.denyCode : error.code})`;
				if (stop !== null)
					return {
						stop,
						detail: `${this.#stops.options.policyBlockedLimit} consecutive policy denials; last: ${detail}`,
					};
				return { content: `Error (${error.code}): ${error.message}. Choose an allowed action.`, isError: true };
			}
			if (error instanceof ApprovalRequiredError) {
				this.#record({ ...base(), fingerprint: this.#safe(fingerprint), verdict: 'refused', errorCode: error.code });
				return { stop: 'policy_blocked', detail: `${action.kind} still requires approval after a grant` };
			}
			if (isFeedbackError(error)) {
				this.#record({ ...base(), fingerprint: this.#safe(fingerprint), verdict: 'failed', errorCode: error.code });
				return { content: `Error (${error.code}): ${error.message}`, isError: true };
			}
			throw error;
		}

		let progress = false;
		let result = `Done: ${action.kind}.`;
		if (action.kind === 'extract') {
			const name = decision.output ?? '';
			const value = outcome.extracted ?? '';
			const spec = this.#outputs.get(name);
			this.#extracted[name] = value;
			if (spec?.sensitive !== false) redactor.addSensitiveValue(value);
			progress = true;
			result =
				spec?.sensitive === false
					? `Extracted into ${name}: ${JSON.stringify(redactor.placeholderize(value))}.`
					: `Extracted into ${name} (sensitive: the value is not shown).`;
		}
		if (outcome.dialog !== undefined) result += ` A ${outcome.dialog.type} dialog is open.`;

		const after = await this.#observe();
		const diff = computeScreenDiff(before, after, { redactor, loadedFrame: outcome.navigation?.framePath ?? null });
		this.#record({
			...base(),
			fingerprint: this.#safe(fingerprint),
			digestAfter: after.digest,
			diff,
			verdict: 'ok',
			...(approved ? { approved: true } : {}),
		});
		this.#logAction(action, fingerprint, before.url, this.#clock.now().getTime() - started);
		this.#observation = after;

		const stop = this.#stops.recordAction({ before: before.digest, after: after.digest, progress });
		if (stop !== null) {
			const help = await this.#askForHelp(
				'dead_end',
				'dead_end',
				'Discovery made no progress: the screen keeps repeating.',
			);
			if (isStop(help)) return help;
			return { content: `${result} ${help.content}`, isError: false };
		}
		return { content: result, isError: false };
	}

	async #requestApproval(
		action: SurfaceAction,
		fingerprint: ElementFingerprint | null,
	): Promise<Stop | { readonly grant: ApprovalGrant }> {
		const { redactor, session } = this.#input;
		const what =
			fingerprint === null
				? ''
				: ` ${fingerprint.role ?? fingerprint.tag} "${fingerprint.name || (fingerprint.labelCellText ?? '')}"`;
		const approval = await session.requestApproval({
			index: this.#steps.length,
			...(fingerprint === null ? {} : { fingerprintKey: fingerprintKey(fingerprint) }),
			description: redactor.placeholderize(`${action.kind}${what}`).slice(0, 500),
		});
		switch (approval.kind) {
			case 'granted':
				return { grant: approval.grant };
			case 'rejected':
			case 'aborted':
				return {
					stop: 'human_aborted',
					detail: `the operator ${approval.kind} the irreversible ${action.kind}`,
					requestId: approval.requestId,
				};
			case 'unattended':
			case 'timeout':
				return {
					stop: 'policy_blocked',
					detail: `the irreversible ${action.kind} needs a human approval (${approval.kind})`,
					requestId: approval.requestId,
				};
		}
	}

	/** Escalates to an operator; resumed → the human actions join the trace and the loop continues. */
	async #askForHelp(
		otherwise: 'dead_end' | 'model_gave_up',
		code: string,
		text: string,
	): Promise<Stop | { readonly content: string; readonly isError: false }> {
		const { session, redactor } = this.#input;
		const before = this.#observation;
		const escalation = await session.escalate(
			{ code, text: redactor.placeholderize(text).slice(0, 1000) },
			{ index: this.#steps.length, description: redactor.placeholderize(text).slice(0, 500), risk: 'read' },
		);
		switch (escalation.kind) {
			case 'aborted':
				return { stop: 'human_aborted', detail: 'the operator aborted the run', requestId: escalation.requestId };
			case 'unattended':
			case 'timeout':
				return {
					stop: otherwise,
					detail: `${text} No operator helped (${escalation.kind}).`,
					requestId: escalation.requestId,
				};
			case 'resumed': {
				const after = await this.#observe();
				this.#recordHumanActions(escalation.humanActions, before, after);
				await session.lease.reacquire('discovery re-observed the screen after the handoff');
				this.#observation = after;
				this.#stops.resetAfterHandoff();
				return {
					content: `An operator took over, performed ${escalation.humanActions.length} action(s) and handed control back. Continue from the current screen.`,
					isError: false,
				};
			}
		}
	}

	#recordHumanActions(actions: readonly SessionHumanAction[], before: Observation, after: Observation): void {
		const { redactor } = this.#input;
		const diff = computeScreenDiff(before, after, { redactor, loadedFrame: after.lastNavigation?.framePath ?? null });
		const screenChanging = new Set(['click', 'press', 'select', 'navigate', 'dismiss_dialog']);
		const last = actions.findLastIndex((action) => !action.refused && screenChanging.has(action.kind));
		actions.forEach((recorded, position) => {
			const action = this.#humanTraceAction(recorded);
			const performed = !recorded.refused && action !== null;
			const carriesDiff = position === last && performed;
			this.#record({
				actor: 'human',
				operator: recorded.operator,
				action: action ?? { kind: 'click' },
				fingerprint: this.#safe(recorded.fingerprint),
				reason: HUMAN_REASON,
				pageRoute: this.#pageRoute(before, recorded.fingerprint),
				digestBefore: before.digest,
				digestAfter: carriesDiff ? after.digest : null,
				diff: carriesDiff ? diff : null,
				verdict: recorded.refused ? 'refused' : action === null ? 'failed' : 'ok',
				...(recorded.denyCode !== undefined || recorded.errorCode !== undefined || action === null
					? { errorCode: recorded.errorCode ?? recorded.denyCode ?? 'NOT_COMPILABLE' }
					: {}),
			});
		});
	}

	/** The trace action of a recorded human gesture; `null` when it cannot become a step. */
	#humanTraceAction(recorded: SessionHumanAction): TraceAction | null {
		const value = recorded.value ?? '';
		const source = (): TraceValue => {
			const param = Object.entries(this.#input.exampleInputs).find(([, example]) => example === value);
			if (param !== undefined) return { kind: 'param', name: param[0] };
			const credentials = this.#input.credentials;
			if (credentials?.username === value) return { kind: 'credential', field: 'username' };
			if (credentials?.password === value) return { kind: 'credential', field: 'password' };
			return { kind: 'literal', value };
		};
		switch (recorded.kind) {
			case 'click':
				return { kind: 'click' };
			case 'fill': {
				const typed = source();
				// The recorder marks every human fill sensitive; that flag is kept, so the compiler refuses a sensitive
				// value that maps to no param or credential. The raw text of such a value never enters the trace.
				const sensitive =
					recorded.sensitive ||
					typed.kind === 'credential' ||
					(typed.kind === 'param' && (this.#context.sensitiveParams?.has(typed.name) ?? true));
				if (sensitive && typed.kind === 'literal')
					return { kind: 'fill', value: { kind: 'literal', value: FULL_MASK }, sensitive };
				return { kind: 'fill', value: typed, sensitive };
			}
			case 'select':
				return { kind: 'select', option: source() };
			case 'press':
				return value === 'Enter' || value === 'Tab' || value === 'Escape' ? { kind: 'press', key: value } : null;
			case 'navigate':
			case 'dismiss_dialog':
				return null;
		}
	}

	async #verifyFinish(decision: ToolDecision & { kind: 'finish' }): Promise<TurnResult> {
		const { session, redactor } = this.#input;
		const missing = [...this.#outputs.keys()].filter((name) => !Object.hasOwn(this.#extracted, name));
		if (missing.length > 0) {
			return { content: `Error: declared outputs not extracted yet: ${missing.join(', ')}.`, isError: true };
		}
		let checkpoint: Checkpoint;
		const proposal = decision.finalCheckpoint;
		if (proposal.kind === 'text') {
			checkpoint = proposalToCheckpoint(proposal);
		} else {
			try {
				const fingerprint = await session.surface.describe({ kind: 'ref', ref: proposal.ref });
				checkpoint = {
					kind: 'element_visible',
					target: buildLocatorLadder(safeFingerprint(fingerprint, redactor), {
						purpose: 'check',
						guard: createTextGuard(this.#knownValues()),
					}),
				};
			} catch (error) {
				if (isFeedbackError(error)) return { content: `Error (${error.code}): ${error.message}`, isError: true };
				throw error;
			}
		}
		const verdict = await session.surface.check(checkpoint, { ...this.#input.exampleInputs }, this.#verifyTimeoutMs);
		this.#log({
			kind: 'checkpoint',
			stepId: null,
			checkpointKind: checkpoint.kind,
			result: verdict.kind === 'held' ? 'held' : 'failed',
			...(verdict.kind === 'held' ? {} : { detail: verdict.observed.slice(0, 900) }),
		});
		if (verdict.kind === 'held') {
			this.#finish = { summary: redactor.placeholderize(decision.summary), finalCheckpoint: checkpoint };
			return { content: 'Goal verified.', isError: false };
		}
		const stop = this.#stops.recordUnverifiedFinish();
		const detail = `the final checkpoint does not hold: ${verdict.observed}`;
		if (stop !== null)
			return { stop, detail: `${this.#stops.options.unverifiedFinishLimit} unverified finishes; last: ${detail}` };
		return { content: `Error: ${detail}. The goal is not met yet.`, isError: true };
	}

	#record(
		step: Omit<TraceStep, 'index' | 'digestAfter' | 'diff'> & { digestAfter?: string | null; diff?: ScreenDiff | null },
	): void {
		this.#steps.push({ digestAfter: null, diff: null, ...step, index: this.#steps.length });
	}

	/** The placeholderized path and query of the element's frame document, else of the top document. */
	#pageRoute(observation: Observation, fingerprint: ElementFingerprint | null): string {
		const frame =
			fingerprint === null
				? undefined
				: observation.frames.find(
						(candidate) => JSON.stringify(candidate.path) === JSON.stringify(fingerprint.framePath),
					);
		const url = frame?.url ?? observation.url;
		const parsed = URL.canParse(url) ? new URL(url) : undefined;
		if (parsed === undefined || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) return '/';
		return this.#input.redactor.placeholderize(`${parsed.pathname}${parsed.search}`);
	}

	#safe(fingerprint: ElementFingerprint | null): ElementFingerprint | null {
		return fingerprint === null ? null : safeFingerprint(fingerprint, this.#input.redactor);
	}

	#knownValues(): string[] {
		const credentials = this.#input.credentials;
		return [
			...Object.values(this.#input.exampleInputs),
			...(credentials === undefined ? [] : [credentials.username, credentials.password]),
			...Object.values(this.#extracted),
		];
	}

	#render(observation: Observation): string {
		return formatObservation(observation, { redactor: this.#input.redactor });
	}

	async #observe(): Promise<Observation> {
		const observation = await this.#input.session.surface.observe();
		this.#log({
			kind: 'observation',
			url: observation.url.slice(0, 1500),
			title: observation.title.slice(0, 400),
			digest: `sha256:${observation.digest.slice(0, 16)}`,
			snapshotRef: null,
			screenshotRef: null,
		});
		return observation;
	}

	#logDecision(call: ModelToolCall, text: string): void {
		const input =
			call.input !== null && typeof call.input === 'object' && !Array.isArray(call.input)
				? (call.input as Record<string, unknown>)
				: { value: call.input };
		const reason = typeof input['reason'] === 'string' ? input['reason'] : text;
		this.#log({
			kind: 'decision',
			reason: this.#input.redactor.placeholderize(reason || '(no reason given)').slice(0, 3000),
			tool: TOOL_NAME.test(call.name) && call.name.length <= 64 ? call.name : 'unknown_tool',
			input: this.#input.redactor.placeholderize(input),
		});
	}

	#logAction(
		action: SurfaceAction,
		fingerprint: ElementFingerprint | null,
		currentUrl: string,
		durationMs: number,
	): void {
		const { risk } = classifyRisk(
			{
				actor: 'agent',
				kind: action.kind,
				currentUrl,
				...(action.kind === 'navigate' ? { targetUrl: action.route } : {}),
				...(fingerprint === null ? {} : { targetName: fingerprint.name }),
			},
			this.#input.policy,
		);
		const target =
			fingerprint === null
				? undefined
				: `${fingerprint.role ?? fingerprint.tag} "${fingerprint.name || (fingerprint.labelCellText ?? '')}"`;
		this.#log({
			kind: 'action',
			actionKind: action.kind,
			risk,
			...(target === undefined ? {} : { target: target.slice(0, 400) }),
			durationMs: Math.max(0, Math.round(durationMs)),
		});
	}

	#log(entry: DistributiveOmit<RunLogEntryInput, 'at' | 'runId' | 'actor'>): void {
		this.#input.session.runLog.log({
			...entry,
			at: this.#clock.now().toISOString(),
			runId: this.#input.session.runId,
			actor: 'agent',
		} as RunLogEntryInput);
	}

	#stopped(stop: Stop): DiscoveryOutcome {
		return {
			kind: 'stopped',
			reason: stop.stop,
			detail: this.#input.redactor.placeholderize(stop.detail),
			trace: this.#trace(),
			turns: this.#stops.turns,
			...(stop.requestId === undefined ? {} : { interventionRequestId: stop.requestId }),
		};
	}

	#budgetDetail(reason: StopReason): string {
		return reason === 'max_steps'
			? `the step budget of ${this.#stops.options.maxSteps} model turns is used up`
			: `the time budget of ${this.#stops.options.timeoutMs} ms is used up`;
	}

	#trace(): DiscoveryTrace {
		return { steps: [...this.#steps], outputs: [...this.#outputs.values()], finish: this.#finish };
	}

	/** Writes every model request as `prompts/turn-NN.json`, redacted with every value known now. */
	async #flushPrompts(): Promise<void> {
		const { session, redactor, model } = this.#input;
		for (const [index, request] of this.#requests.entries()) {
			const document = {
				turn: index + 1,
				model: model.modelId,
				system: request.system,
				tools: request.tools.map((tool) => tool.name),
				messages: request.messages.map((message) =>
					message.role === 'assistant'
						? { role: message.role, text: message.text, toolCalls: message.toolCalls }
						: message,
				),
			};
			await session.evidence.putJson(
				`turn-${String(index + 1).padStart(2, '0')}`,
				redactor.redact(document),
				'prompts',
			);
		}
	}
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
