import type {
	AppProfile,
	ArtifactRef,
	CapabilityArtifact,
	FailureReason,
	InterventionId,
	OutputSpec,
	ParamSpecSchema,
	RunId,
	RunResult,
} from '@idp/artifact-schema';
import { systemClock, type Clock, type Random } from '@idp/evidence';
import { createRedactor, FULL_MASK, type Redacted, type Redactor, type ResolvedPolicy } from '@idp/policy';
import { openLiveSession, type LiveSession, type OpenLiveSessionOptions } from '@idp/session';
import type { z } from 'zod';
import { ArtifactCompiler } from './compiler/ArtifactCompiler.js';
import { assertNoConcreteValues } from './compiler/assertNoConcreteValues.js';
import type { DiscoveryOutcome, StopReason } from './loop/DiscoveryOutcome.js';
import { DiscoveryLoop, type DiscoveryLoopOptions } from './loop/DiscoveryLoop.js';
import type { ModelClient } from './model/ModelClient.js';

/** The inputs of one discovery run: goal, params with example inputs, profile, policy, model and session options. */
export interface DiscoveryRunnerOptions {
	/** The natural-language goal; it may contain example values (they are placeholderized everywhere). */
	readonly goal: string;
	/** The capability's params; each needs an example input. */
	readonly params: readonly z.input<typeof ParamSpecSchema>[];
	/** The example input of each param, by name. */
	readonly exampleInputs: Readonly<Record<string, string>>;
	/** The outputs; default: those the model declares. */
	readonly outputs?: readonly OutputSpec[];
	/** The sign-on credential named by `profile.credentialRef`, resolved by the caller (e.g. from `.env`). */
	readonly credentials?: { readonly username: string; readonly password: string };
	/** The app profile, with `origin` already expanded to a URL. */
	readonly profile: AppProfile;
	readonly policy: ResolvedPolicy;
	/** The model: `AnthropicModelClient`, or `ScriptedModel` for keyless / test runs. */
	readonly model: ModelClient;
	/** The runs root; the run directory is `<runsRoot>/<runId>/`. */
	readonly runsRoot: string;
	/** Entry route the loop opens before the first observation. Default `profile.loginRoute`; `null` = none. */
	readonly target?: string | null;
	/**
	 * Budgets and the finish-verification timeout (see `DiscoveryLoopOptions`, `StopOptions`). `loop.clock`
	 * drives only the time budget (default: `clock`); a frozen test clock belongs here, not in `clock`, because
	 * the browser surface waits on the session clock.
	 */
	readonly loop?: DiscoveryLoopOptions;
	/** Default false: interventions are raised and persisted, and the run stops. */
	readonly attended?: boolean;
	readonly headless?: boolean;
	readonly slowMo?: number;
	readonly controlPort?: number;
	readonly interventionTimeoutMs?: number;
	/** Capability id, title and version of the compiled artifact (defaults: from the goal, `1.0.0`). */
	readonly id?: string;
	readonly title?: string;
	readonly version?: string;
	readonly clock?: Clock;
	readonly random?: Random;
	/** Test seam: the browser launcher passed to `openLiveSession`. */
	readonly launch?: OpenLiveSessionOptions['launch'];
	/**
	 * Called once the session is open, before the loop starts: an attended session's control URL and bearer token
	 * are known here (the CLI writes its control files and prints the URL, never the token). A throw closes the
	 * session and fails the run.
	 */
	readonly onSessionOpen?: (session: DiscoverySessionInfo) => Promise<void>;
	/** Called after the session has closed (also on failure), e.g. to remove the control files. */
	readonly onSessionClosed?: (session: DiscoverySessionInfo) => Promise<void>;
}

/** What `onSessionOpen` / `onSessionClosed` learn about the live session. */
export interface DiscoverySessionInfo {
	readonly runId: RunId;
	/** Absolute path of the run directory. */
	readonly runDir: string;
	/** The localhost control API URL; null when unattended. */
	readonly controlUrl: string | null;
	/** The control API bearer token; null when unattended. A secret: hand it over through a 0600 file, never log it. */
	readonly controlToken: string | null;
}

/** What a discovery run produced: the loop outcome and, on `goal_met` only, the compiled artifact and its paths. */
export interface DiscoveryRunResult {
	readonly outcome: DiscoveryOutcome;
	/** The compiled artifact (goal met only). */
	readonly artifact?: CapabilityArtifact;
	/** Absolute path of `artifact.json` (goal met only). */
	readonly artifactPath?: string;
	readonly artifactRef?: ArtifactRef;
	readonly runId: RunId;
	/** Absolute path of the run directory. */
	readonly runDir: string;
}

/**
 * How a stop is reported in `result.json` (a `failure`; the exact stop reason is in `observed`). There is no
 * discovery-specific failure reason in the result contract, so the nearest one is used.
 */
export const STOP_FAILURE_REASONS: Readonly<Record<StopReason, FailureReason>> = Object.freeze({
	max_steps: 'timeout',
	timeout: 'timeout',
	dead_end: 'recovery_exhausted',
	policy_blocked: 'policy_denied',
	goal_unverified: 'checkpoint_failed',
	model_gave_up: 'recovery_exhausted',
	human_aborted: 'human_aborted',
	// The provider call failed after the SDK's bounded retries: the nearest contract reason (code `model_error`).
	model_error: 'recovery_exhausted',
});

const EXPECTED = 'the discovery goal met and verified on screen';

/**
 * Composes one discovery run (R1, R2): opens a live session (run kind `discovery`, automation actor `agent`)
 * → runs the `DiscoveryLoop` → compiles only on `goal_met` (FR6, AC2) → `assertNoConcreteValues` → writes
 * `artifact.json`, `result.json` and the manifest. A stopped run writes a `failure` result and no artifact.
 * One redactor, seeded with the example inputs (as `{{param}}` placeholders) and the credentials, serves the
 * session sinks, the prompts and the compiler (invariant 3).
 */
export class DiscoveryRunner {
	constructor(private readonly options: DiscoveryRunnerOptions) {}

	/**
	 * Runs the discovery once; the session is always closed (its manifest written) before this returns. A stop is
	 * a returned `stopped` outcome, not a throw.
	 * A model API failure (`ModelCallError` after the client's retries) is a `model_error` stop with a `failure`
	 * result (`observed` records whether it is retryable); a model call cut off by the time budget is `timeout`.
	 * @throws the compiler's typed errors (`ArtifactCompileError`, `UnparameterizedSensitiveValueError`,
	 *   `ConcreteValueLeakError`, …) after writing a `failure` / `artifact_invalid` result, when the goal was met
	 *   but the run does not compile; `ScriptError` from a scripted model.
	 */
	async run(): Promise<DiscoveryRunResult> {
		const options = this.options;
		const clock = options.clock ?? systemClock;
		const started = clock.now().getTime();
		const redactor = createRedactor({
			config: options.policy,
			sensitiveValues: [
				...Object.entries(options.exampleInputs).map(([paramName, value]) => ({ value, paramName })),
				...(options.credentials === undefined ? [] : [options.credentials.username, options.credentials.password]),
			],
		});
		const goal = redactor.placeholderize(options.goal);
		const session = await openLiveSession({
			policy: options.policy,
			redactor,
			runsRoot: options.runsRoot,
			runKind: 'discovery',
			automationActor: 'agent',
			origin: options.profile.origin,
			attended: options.attended ?? false,
			subject: { kind: 'goal', goal },
			clock,
			...(options.random === undefined ? {} : { random: options.random }),
			...(options.headless === undefined ? {} : { headless: options.headless }),
			...(options.slowMo === undefined ? {} : { slowMo: options.slowMo }),
			...(options.controlPort === undefined ? {} : { controlPort: options.controlPort }),
			...(options.interventionTimeoutMs === undefined ? {} : { interventionTimeoutMs: options.interventionTimeoutMs }),
			...(options.launch === undefined ? {} : { launch: options.launch }),
		});

		const info: DiscoverySessionInfo = {
			runId: session.runId,
			runDir: session.runDir.path,
			controlUrl: session.controlUrl,
			controlToken: session.controlToken,
		};
		let result: DiscoveryRunResult;
		try {
			await options.onSessionOpen?.(info);
			result = await this.#drive(session, { redactor, goal, clock, started });
		} catch (error) {
			try {
				await session.close();
				await options.onSessionClosed?.(info);
			} catch (closeError) {
				throw new AggregateError([error, closeError], 'discovery failed and the session did not close cleanly', {
					cause: closeError,
				});
			}
			throw error;
		}
		await session.close();
		await options.onSessionClosed?.(info);
		return result;
	}

	async #drive(
		session: LiveSession,
		context: { readonly redactor: Redactor; readonly goal: string; readonly clock: Clock; readonly started: number },
	): Promise<DiscoveryRunResult> {
		const options = this.options;
		const { redactor, goal, clock } = context;
		const runId = session.runId;
		const durationMs = () => Math.max(0, clock.now().getTime() - context.started);
		session.runLog.log({
			kind: 'run_started',
			at: clock.now().toISOString(),
			runId,
			actor: 'agent',
			runKind: 'discovery',
			artifact: null,
			goal,
			origin: options.profile.origin,
		});
		const target = options.target === undefined ? options.profile.loginRoute : options.target;
		const outcome = await DiscoveryLoop.run({
			goal: options.goal,
			...(target === null ? {} : { target }),
			exampleInputs: options.exampleInputs,
			params: options.params.map((param) => ({
				name: param.name,
				description: param.description,
				sensitive: param.sensitive ?? true,
			})),
			...(options.credentials === undefined ? {} : { credentials: options.credentials }),
			session,
			model: options.model,
			redactor,
			policy: options.policy,
			options: { clock, ...options.loop },
		});
		const base = { outcome, runId, runDir: session.runDir.path };

		if (outcome.kind === 'stopped') {
			await this.#writeFailure(
				session,
				redactor,
				{
					reason: STOP_FAILURE_REASONS[outcome.reason],
					code: outcome.reason,
					observed: `discovery stopped (${outcome.reason}): ${outcome.detail}`,
					durationMs: durationMs(),
					...(outcome.interventionRequestId === undefined
						? {}
						: { interventionRequestId: outcome.interventionRequestId }),
				},
				clock,
			);
			return base;
		}

		const concrete = {
			exampleInputs: Object.values(options.exampleInputs),
			credentials:
				options.credentials === undefined ? [] : [options.credentials.username, options.credentials.password],
			extracted: Object.values(outcome.extracted),
		};
		let artifact: CapabilityArtifact;
		try {
			artifact = await new ArtifactCompiler().compile(outcome.trace, {
				goal,
				params: options.params,
				...(options.outputs === undefined ? {} : { outputs: options.outputs }),
				profile: options.profile,
				policy: options.policy,
				runId,
				modelId: options.model.modelId,
				clock,
				...(options.id === undefined ? {} : { id: options.id }),
				...(options.title === undefined ? {} : { title: options.title }),
				...(options.version === undefined ? {} : { version: options.version }),
				sensitiveValues: [...concrete.exampleInputs, ...concrete.credentials, ...concrete.extracted],
			});
			assertNoConcreteValues(artifact, concrete, { redaction: options.policy.redaction });
		} catch (error) {
			await this.#writeFailure(
				session,
				redactor,
				{
					reason: 'artifact_invalid',
					code: 'artifact_invalid',
					observed: `the goal was met but the run did not compile: ${error instanceof Error ? error.message : String(error)}`,
					durationMs: durationMs(),
				},
				clock,
			);
			throw error;
		}

		// Safe to brand: assertNoConcreteValues proved the artifact holds no example input, credential or extracted
		// value, and every text in it is placeholderized or guarded. Running the whole artifact through the redactor
		// instead would mask structural fields (hashes, numeric-looking ids) and break the contract.
		const artifactRef = await session.manifest.writeArtifact(artifact as Redacted<CapabilityArtifact>);
		const sensitive = new Set(artifact.outputs.filter((output) => output.sensitive).map((output) => output.name));
		const outputs: Record<string, string> = {};
		for (const output of artifact.outputs) {
			const value = outcome.extracted[output.name] ?? '';
			outputs[output.name] = sensitive.has(output.name) ? FULL_MASK : redactor.redactString(value);
		}
		const success: RunResult = {
			kind: 'success',
			runId,
			artifact: artifactRef,
			outputs,
			durationMs: durationMs(),
			drift: [],
			recoveries: 0,
		};
		// Safe to brand: the only free text (output values) is masked or redacted above; the rest is structural.
		await session.manifest.writeResult(success as Redacted<RunResult>);
		session.runLog.log({
			kind: 'result',
			at: clock.now().toISOString(),
			runId,
			actor: 'agent',
			resultKind: 'success',
			durationMs: success.durationMs,
		});
		return { ...base, artifact, artifactPath: session.runDir.artifactPath, artifactRef };
	}

	async #writeFailure(
		session: LiveSession,
		redactor: Redactor,
		failure: {
			readonly reason: FailureReason;
			readonly code: string;
			readonly observed: string;
			readonly durationMs: number;
			readonly interventionRequestId?: InterventionId;
		},
		clock: Clock,
	): Promise<void> {
		const result: RunResult = {
			kind: 'failure',
			runId: session.runId,
			artifact: null,
			reason: failure.reason,
			step: null,
			expected: EXPECTED,
			observed: redactor.redactString(failure.observed).slice(0, 2000),
			evidence: [],
			...(failure.interventionRequestId === undefined ? {} : { interventionRequestId: failure.interventionRequestId }),
		};
		// Safe to brand: `observed` is redacted above; `expected` is a constant; the rest is structural.
		await session.manifest.writeResult(result as Redacted<RunResult>);
		session.runLog.log({
			kind: 'result',
			at: clock.now().toISOString(),
			runId: session.runId,
			actor: 'agent',
			resultKind: 'failure',
			code: failure.code,
			durationMs: failure.durationMs,
		});
	}
}
