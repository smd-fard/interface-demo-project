import {
	StepIdSchema,
	type InterventionId,
	type InterventionRequest,
	type OperatorActor,
	type RunId,
	type RunKind,
} from '@idp/artifact-schema';
import {
	EvidenceStore,
	newRunId,
	RunDirectory,
	RunLog,
	RunManifestWriter,
	systemClock,
	systemRandom,
	type Clock,
	type Random,
} from '@idp/evidence';
import {
	classifyRisk,
	isActionKind,
	type ActionIntent,
	type LandingVerdict,
	type PolicyVerdict,
	type Redactor,
	type ResolvedPolicy,
} from '@idp/policy';
import {
	ApprovalGrantRegistry,
	HumanActionRecorder,
	launchWebSurface,
	PolicyGuardedSurface,
	type ApprovalGrant,
	type BrowserHandle,
	type ElementFingerprint,
	type LaunchWebSurfaceOptions,
	type RecordedHumanAction,
	type Surface,
	type VerdictStage,
	type WebSurfaceSession,
} from '@idp/surface';
import { ControlServer } from './control/ControlServer.js';
import type { ControlTarget } from './control/ControlTarget.js';
import type { LeaseView } from './control/LeaseView.js';
import { InterventionTimeoutError } from './errors/InterventionTimeoutError.js';
import { LeaseNotHeldError } from './errors/LeaseNotHeldError.js';
import { SessionValidationError } from './errors/SessionValidationError.js';
import {
	InterventionService,
	type InterventionStep,
	type InterventionSubject,
} from './intervention/InterventionService.js';
import { ControlLease, type AutomationActor } from './lease/ControlLease.js';
import { LeasedSurface } from './lease/LeasedSurface.js';

/** Configures `openLiveSession`: policy, redactor, run directory, target origin, browser and attended mode. */
export interface OpenLiveSessionOptions {
	readonly policy: ResolvedPolicy;
	/** Redacts everything the session writes (run log, intervention requests, evidence, the control API). */
	readonly redactor: Redactor;
	/** The runs root; the run directory is `<runsRoot>/<runId>/`. */
	readonly runsRoot: string;
	readonly runKind: RunKind;
	/** Default: a new id for `runKind`. */
	readonly runId?: RunId;
	/** The app origin (routes are relative to it). */
	readonly origin: string;
	/** Origins the browser may reach (default `[origin]`). */
	readonly allowedOrigins?: readonly string[];
	/** Default true. An attended demo runs headed so the operator can take over the same window. */
	readonly headless?: boolean;
	readonly slowMo?: number;
	/** Attended: a control server runs and requests wait for an operator. Unattended: requests return at once. */
	readonly attended: boolean;
	/** Control server port (default 0 = ephemeral). Ignored when unattended. */
	readonly controlPort?: number;
	/** What the run is doing, for intervention requests: a capability (replay) or a goal (discovery). */
	readonly subject: InterventionSubject;
	/** Default: `agent` for discovery, `replay` for replay. Must match the run kind. */
	readonly automationActor?: AutomationActor;
	/** How long `requestApproval` / `escalate` wait for an operator by default (default 15 minutes). */
	readonly interventionTimeoutMs?: number;
	readonly clock?: Clock;
	readonly random?: Random;
	/** Launches the browser surface (default `launchWebSurface`); a seam for tests. */
	readonly launch?: (options: LaunchWebSurfaceOptions) => Promise<WebSurfaceSession>;
}

/** A human action recorded during a takeover, with the operator who performed it. */
export type SessionHumanAction = RecordedHumanAction & { readonly operator: OperatorActor };

/** The step an approval is requested for. */
export interface ApprovalStep {
	/** 0-based step index (replay) or action count so far (discovery). */
	readonly index: number;
	/** The replayed step: goes into the request and binds the grant. */
	readonly stepId?: string;
	/** `fingerprintKey(fingerprint)` of the target (agent, no step id): binds the grant. */
	readonly fingerprintKey?: string;
	/** What the action does, e.g. "Click Confirm". Redacted before it is stored. */
	readonly description: string;
	/** Default `{ code: 'approval_required', text: 'Approval required: <description>' }`. */
	readonly reason?: InterventionRequest['reason'];
}

/** Per-call overrides for `requestApproval` / `escalate`. */
export interface InterventionCallOptions {
	/** Overrides the session's `interventionTimeoutMs`. */
	readonly timeoutMs?: number;
	/** Overrides the session's subject. */
	readonly subject?: InterventionSubject;
}

/** The outcome of `requestApproval`. */
export type ApprovalOutcome =
	/** Approved: the lease is back in `AGENT`; act once with `approvalGrant: grant`. */
	| { readonly kind: 'granted'; readonly requestId: InterventionId; readonly grant: ApprovalGrant }
	/** Rejected: the lease is `CLOSED`. */
	| { readonly kind: 'rejected'; readonly requestId: InterventionId }
	/** The operator aborted the run: the lease is `CLOSED`. */
	| { readonly kind: 'aborted'; readonly requestId: InterventionId }
	/** Nobody answered in time: the lease stays `PAUSED`, the request open. */
	| { readonly kind: 'timeout'; readonly requestId: InterventionId }
	/** Unattended: the request is raised and persisted; the lease is `PAUSED`. */
	| { readonly kind: 'unattended'; readonly requestId: InterventionId };

/** The outcome of `escalate`. */
export type EscalationOutcome =
	/** The operator handed control back: the lease is `RESUMING`. Re-verify the checkpoint, then `lease.reacquire()`. */
	| {
			readonly kind: 'resumed';
			readonly requestId: InterventionId;
			readonly humanActions: readonly SessionHumanAction[];
	  }
	/** The operator aborted the run: the lease is `CLOSED`. */
	| {
			readonly kind: 'aborted';
			readonly requestId: InterventionId;
			readonly humanActions: readonly SessionHumanAction[];
	  }
	| { readonly kind: 'timeout'; readonly requestId: InterventionId }
	| { readonly kind: 'unattended'; readonly requestId: InterventionId };

const DEFAULT_TIMEOUT_MS = 15 * 60_000;

/** One line about a recorded action for the run log: kind, role, name, frame — never the typed value. */
function describeHumanAction(action: RecordedHumanAction): string {
	const fp: ElementFingerprint | null = action.fingerprint;
	const where =
		fp === null
			? ''
			: ` ${fp.role} "${fp.name !== '' ? fp.name : (fp.labelCellText ?? fp.tag)}" in frame ${
					fp.framePath.length === 0 ? 'top' : fp.framePath.join('/')
				}`;
	const problem = action.errorCode ?? action.denyCode;
	return `${action.kind}${where}${problem === undefined ? '' : ` (${problem})`}`.slice(0, 500);
}

/**
 * A live session (R6.1–R6.3): one browser, one run directory, one control lease. Composed by `openLiveSession`:
 * the web surface, wrapped by the policy guard (invariant 2) and then by the lease check (FR20) — `surface`
 * is that leased, guarded surface and the only one handed out. Guard verdicts go to the run log
 * (`policy_verdict`), lease transitions too (`lease_change`), and while the lease is `HUMAN` the human-action
 * recorder mediates the operator's gestures through a second guard whose inner surface is lease-checked for
 * `human` (so a human, too, acts only while holding the lease); each recorded action is logged
 * (`human_action`, actor `operator:<handle>`, no values). Attended sessions run the localhost control API.
 *
 * Protocol for replay and agent:
 * - `ApprovalRequiredError` on an irreversible action → `requestApproval(step)`. On `granted` the lease is
 *   already back in `AGENT` (nothing changed on screen: no human acted), so act once with the grant.
 * - Stuck → `escalate(reason, currentStep)`. On `resumed` the lease is `RESUMING`: re-observe, re-verify the
 *   current checkpoint, then `lease.reacquire()` before acting (a mismatch is a hard failure).
 * - Unattended, both return `{ kind: 'unattended', requestId }` at once (the request is persisted; the lease
 *   stays `PAUSED`); the caller fails with the request ref.
 * - Write the run result (`manifest.writeResult`) before `close()`.
 */
export class LiveSession {
	private readonly humanActions: SessionHumanAction[] = [];
	private readonly recorderErrors: unknown[] = [];
	private recorderTask: Promise<void> = Promise.resolve();
	private recordingOperator: OperatorActor | null = null;
	private closing: Promise<void> | undefined;

	/** @internal Use `openLiveSession`. */
	constructor(
		/** The leased, policy-guarded surface: the only surface the automation gets. */
		readonly surface: Surface,
		readonly lease: ControlLease,
		readonly interventions: InterventionService,
		readonly runLog: RunLog,
		readonly evidence: EvidenceStore,
		readonly manifest: RunManifestWriter,
		readonly runDir: RunDirectory,
		readonly grants: ApprovalGrantRegistry,
		/** The opaque browser handle (bring to front, close); the operator's window in a headed session. */
		readonly browser: BrowserHandle,
		private readonly recorder: HumanActionRecorder,
		private readonly humanGuard: PolicyGuardedSurface,
		private readonly settings: {
			readonly attended: boolean;
			readonly subject: InterventionSubject;
			readonly timeoutMs: number;
			readonly redactor: Redactor;
			readonly clock: Clock;
		},
		private controlServer: ControlServer | null = null,
	) {}

	/** The control API base URL (attended only). */
	get controlUrl(): string | null {
		return this.controlServer?.url ?? null;
	}

	/** The control API bearer token (attended only). Hand it to the operator process; never log it. */
	get controlToken(): string | null {
		return this.controlServer?.token ?? null;
	}

	get runId(): RunId {
		return this.runDir.runId;
	}

	/** Every human action recorded so far in this session, in order (fill values are raw: redact before any sink). */
	recordedHumanActions(): readonly SessionHumanAction[] {
		return [...this.humanActions];
	}

	/**
	 * Raises an approval request for an irreversible action and waits for the operator. On approve the lease
	 * goes PAUSED → RESUMING → AGENT (reacquired here) and the single-use grant is returned.
	 */
	async requestApproval(step: ApprovalStep, options: InterventionCallOptions = {}): Promise<ApprovalOutcome> {
		const stepId = step.stepId === undefined ? undefined : StepIdSchema.safeParse(step.stepId);
		if (stepId !== undefined && !stepId.success) throw new SessionValidationError('stepId', 'not a step id');
		const request = await this.interventions.raise({
			kind: 'approval',
			reason: step.reason ?? { code: 'approval_required', text: `Approval required: ${step.description}` },
			subject: options.subject ?? this.settings.subject,
			currentStep: {
				index: step.index,
				...(stepId?.data === undefined ? {} : { id: stepId.data }),
				description: step.description,
				risk: 'irreversible',
			},
			grantBinding: {
				...(stepId?.data === undefined ? {} : { stepId: stepId.data }),
				...(step.fingerprintKey === undefined ? {} : { fingerprintKey: step.fingerprintKey }),
			},
		});
		const requestId = request.id;
		if (!this.settings.attended) return { kind: 'unattended', requestId };
		const resolution = await this.wait(requestId, options);
		if (resolution === 'timeout') return { kind: 'timeout', requestId };
		if (resolution.decision === 'approve' && resolution.grant !== undefined) {
			await this.lease.reacquire('approval granted');
			return { kind: 'granted', requestId, grant: resolution.grant };
		}
		return { kind: resolution.decision === 'reject' ? 'rejected' : 'aborted', requestId };
	}

	/**
	 * Raises a takeover request and waits until the operator resumes (or aborts). Returns the human actions
	 * recorded during the takeover. On `resumed` the lease is RESUMING: re-verify, then `lease.reacquire()`.
	 */
	async escalate(
		reason: InterventionRequest['reason'],
		currentStep: InterventionStep,
		options: InterventionCallOptions = {},
	): Promise<EscalationOutcome> {
		const request = await this.interventions.raise({
			kind: 'takeover',
			reason,
			subject: options.subject ?? this.settings.subject,
			currentStep,
		});
		const requestId = request.id;
		if (!this.settings.attended) return { kind: 'unattended', requestId };
		const before = this.humanActions.length;
		const resolution = await this.wait(requestId, options);
		if (resolution === 'timeout') return { kind: 'timeout', requestId };
		await this.recorderIdle();
		const humanActions = this.humanActions.slice(before);
		return { kind: resolution.decision === 'resumed' ? 'resumed' : 'aborted', requestId, humanActions };
	}

	/** Closes the lease, the recorder, the control server, the browser and the run log; writes the manifest. */
	close(): Promise<void> {
		this.closing ??= this.doClose();
		return this.closing;
	}

	/** @internal The control API's view of this session. */
	controlTarget(): ControlTarget {
		const { interventions, evidence, browser } = this;
		return {
			lease: () => this.leaseView(),
			interventions: () => interventions.list(),
			intervention: (id) => interventions.get(id),
			evidence: (refId) => evidence.get(refId),
			claim: async (id, operator) => {
				const request = await interventions.claim(id, operator);
				await this.recorderIdle();
				if (!browser.closed) await browser.bringToFront();
				return request;
			},
			approve: (id, operator) => interventions.approve(id, operator),
			reject: (id, operator) => interventions.reject(id, operator),
			resume: async (operator) => {
				await interventions.resume(operator);
				await this.recorderIdle();
				return this.leaseView();
			},
			abort: async (operator) => {
				await interventions.abort(operator);
				await this.recorderIdle();
				return this.leaseView();
			},
		};
	}

	/** @internal Wires the lease, guard and recorder to the run log. Called once by `openLiveSession`. */
	wire(controlServer: ControlServer | null): void {
		this.controlServer = controlServer;
		this.lease.onChange((transition) => {
			this.runLog.log({
				kind: 'lease_change',
				at: transition.at,
				runId: this.runId,
				actor: transition.actor,
				transition,
			});
			if (transition.to === 'HUMAN') {
				const operator = transition.actor as OperatorActor;
				this.chainRecorder(async () => {
					this.recordingOperator = operator;
					await this.recorder.start(this.humanGuard, (action) => this.onHumanAction(action));
				});
			} else if (transition.from === 'HUMAN') {
				this.chainRecorder(async () => {
					await this.recorder.stop();
					this.recordingOperator = null;
				});
			}
		});
	}

	/** @internal The guard's verdict listener → run log (`policy_verdict`). */
	onVerdict(
		policy: ResolvedPolicy,
		verdict: PolicyVerdict | LandingVerdict,
		intent: ActionIntent,
		stage: VerdictStage,
	) {
		if (!isActionKind(intent.kind)) return; // an unregistered kind is denied and thrown by the guard; not loggable
		if (stage === 'landing' && verdict.kind === 'allow') return; // the action verdict was logged already
		let actor: OperatorActor | AutomationActor = this.lease.automationActor;
		if (intent.actor === 'human') {
			const operator = this.lease.operator();
			if (operator === null) throw new LeaseNotHeldError('human', this.lease.state());
			actor = operator;
		}
		const risk =
			verdict.kind === 'allow' && 'risk' in verdict
				? verdict.risk
				: verdict.kind === 'require_approval'
					? 'irreversible'
					: classifyRisk({ ...intent, kind: intent.kind }, policy).risk;
		const stepId = intent.stepId === undefined ? undefined : StepIdSchema.safeParse(intent.stepId);
		this.runLog.log({
			kind: 'policy_verdict',
			at: this.settings.clock.now().toISOString(),
			runId: this.runId,
			actor,
			verdict: verdict.kind,
			...(verdict.kind === 'deny' ? { code: verdict.code } : {}),
			risk,
			actionKind: intent.kind,
			...(stepId?.success === true ? { stepId: stepId.data } : {}),
		});
	}

	private leaseView(): LeaseView {
		const { redactor } = this.settings;
		return {
			state: this.lease.state(),
			holder: this.lease.holder(),
			history: this.lease.history().map((transition) => ({
				...transition,
				reason: redactor.redactString(transition.reason),
			})),
		};
	}

	private onHumanAction(action: RecordedHumanAction): void {
		const operator = this.recordingOperator;
		if (operator === null) throw new LeaseNotHeldError('human', this.lease.state());
		this.humanActions.push({ ...action, operator });
		this.runLog.log({
			kind: 'human_action',
			at: action.at,
			runId: this.runId,
			actor: operator,
			actionKind: action.kind,
			// A gesture that could not be evaluated (verdict null: not replayable, lease not held) was not performed.
			verdict: action.verdict ?? 'deny',
			refused: action.refused,
			fingerprint: describeHumanAction(action),
		});
	}

	private chainRecorder(step: () => Promise<void>): void {
		this.recorderTask = this.recorderTask.then(step).catch((error: unknown) => {
			this.recorderErrors.push(error);
		});
	}

	/** Waits for pending recorder start/stop; rethrows any recorder failure (never swallowed). */
	private async recorderIdle(): Promise<void> {
		await this.recorderTask;
		const errors = [...this.recorderErrors.splice(0), ...this.recorder.errors.splice(0)];
		if (errors.length === 1) throw errors[0];
		if (errors.length > 1) throw new AggregateError(errors, 'the human-action recorder failed');
	}

	private async wait(
		requestId: InterventionId,
		options: InterventionCallOptions,
	): Promise<Awaited<ReturnType<InterventionService['awaitResolution']>> | 'timeout'> {
		try {
			return await this.interventions.awaitResolution(requestId, {
				timeoutMs: options.timeoutMs ?? this.settings.timeoutMs,
			});
		} catch (error) {
			if (error instanceof InterventionTimeoutError) return 'timeout';
			throw error;
		}
	}

	private async doClose(): Promise<void> {
		const failures: unknown[] = [];
		const attempt = async (step: () => Promise<unknown>) => {
			try {
				await step();
			} catch (error) {
				failures.push(error);
			}
		};
		await attempt(() => this.lease.close(this.lease.automationActor));
		await attempt(() => this.recorderIdle());
		await attempt(() => this.controlServer?.close() ?? Promise.resolve());
		if (this.controlServer !== null) failures.push(...this.controlServer.errors.splice(0));
		await attempt(() => this.browser.close());
		await attempt(() => this.runLog.close());
		await attempt(() => this.manifest.writeManifest({ endedAt: this.settings.clock.now() }));
		// Every step ran; the failures are reported, not swallowed.
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, 'closing the live session failed');
	}
}

/**
 * Opens a live session: launches the web surface, stacks guard → lease, creates the run directory, run log,
 * evidence store and manifest (the store reports every ref to the manifest), wires verdicts, lease changes
 * and the human-action recorder to the run log, and starts the control server when attended.
 *
 * @throws SessionValidationError when `automationActor` or `runId` does not match `runKind`.
 * @throws ControlServerStartError when attended and the control server cannot listen.
 */
export async function openLiveSession(options: OpenLiveSessionOptions): Promise<LiveSession> {
	const clock = options.clock ?? systemClock;
	const random = options.random ?? systemRandom;
	const automationActor = options.automationActor ?? (options.runKind === 'discovery' ? 'agent' : 'replay');
	if ((automationActor === 'agent') !== (options.runKind === 'discovery')) {
		throw new SessionValidationError('automationActor', `must be "agent" for discovery and "replay" for replay`);
	}
	const runId = options.runId ?? newRunId(options.runKind, clock, random);
	if (!runId.startsWith(`${options.runKind}-`)) throw new SessionValidationError('runId', 'must match the run kind');

	const runDir = await RunDirectory.create(options.runsRoot, runId);
	const manifest = new RunManifestWriter(runDir, { startedAt: clock.now() });
	const evidence = new EvidenceStore(runDir, { onPut: (ref) => manifest.addEvidence(ref) });
	const runLog = RunLog.create(runDir, options.redactor);
	await manifest.writeManifest();

	const launch = options.launch ?? launchWebSurface;
	let web: WebSurfaceSession;
	try {
		web = await launch({
			origin: options.origin,
			...(options.allowedOrigins === undefined ? {} : { allowedOrigins: options.allowedOrigins }),
			headless: options.headless ?? true,
			...(options.slowMo === undefined ? {} : { slowMo: options.slowMo }),
			clock,
		});
	} catch (error) {
		await runLog.close();
		throw error;
	}

	const lease = new ControlLease({ automationActor, clock });
	const grants = new ApprovalGrantRegistry({ clock, defaultTtlMs: options.policy.approvalExpiresMs });
	const onVerdict = (verdict: PolicyVerdict | LandingVerdict, intent: ActionIntent, stage: VerdictStage) =>
		// Called only when an action runs, i.e. after the session below exists.
		session.onVerdict(options.policy, verdict, intent, stage);
	const guard = (inner: Surface) =>
		new PolicyGuardedSurface({ inner, policy: options.policy, origin: options.origin, grants, onVerdict });
	// Automation: lease → guard → browser. Human (recorder): guard → lease → browser.
	const surface = new LeasedSurface(guard(web.surface), lease);
	const humanGuard = guard(new LeasedSurface(web.surface, lease));
	const interventions = new InterventionService({
		runId,
		runKind: options.runKind,
		surface,
		redactor: options.redactor,
		evidence,
		runLog,
		lease,
		grants,
		clock,
		random,
	});
	const session: LiveSession = new LiveSession(
		surface,
		lease,
		interventions,
		runLog,
		evidence,
		manifest,
		runDir,
		grants,
		web.handle,
		new HumanActionRecorder(web.handle, { clock }),
		humanGuard,
		{
			attended: options.attended,
			subject: options.subject,
			timeoutMs: options.interventionTimeoutMs ?? DEFAULT_TIMEOUT_MS,
			redactor: options.redactor,
			clock,
		},
	);

	let controlServer: ControlServer | null = null;
	if (options.attended) {
		try {
			// The bearer token always comes from system randomness, never from the injected (test) source.
			controlServer = await ControlServer.start({ target: session.controlTarget(), port: options.controlPort ?? 0 });
		} catch (error) {
			await web.handle.close();
			await runLog.close();
			throw error;
		}
	}
	session.wire(controlServer);
	return session;
}
