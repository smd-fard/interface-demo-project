import {
	CapabilityArtifactSchema,
	computeContentHash,
	paramsSchemaFor,
	type AppProfile,
	type ArtifactRef,
	type CapabilityArtifact,
	type ParamValues,
	type RunResult,
} from '@idp/artifact-schema';
import { systemClock, type Clock } from '@idp/evidence';
import type { Redactor } from '@idp/policy';
import { CheckpointVerifier } from './checkpoints/CheckpointVerifier.js';
import { ReplayError } from './errors/ReplayError.js';
import { extractOutputs } from './outputs/extractOutputs.js';
import { createValueBinder } from './params/bindValues.js';
import type { CredentialProvider } from './params/CredentialProvider.js';
import { resolveReplayOptions, type ReplayOptionsInput } from './ReplayOptions.js';
import type { ReplaySession } from './ReplaySession.js';
import { ReplayStateError } from './errors/ReplayStateError.js';
import { redactResultForSink } from './result/redactResultForSink.js';
import { ResultBuilder } from './result/ResultBuilder.js';
import { RunState } from './steps/RunState.js';
import type { StepContext } from './steps/StepContext.js';
import { StepRunner } from './steps/StepRunner.js';

/** Everything one `replay` call needs: the artifact, the caller params, the live session and its redactor. */
export interface ReplayInput {
	/** The capability artifact document (parsed and hash-checked here; a bad one fails with `artifact_invalid`). */
	readonly artifact: unknown;
	/** Caller params (CLI strings or typed JSON), validated with `paramsSchemaFor`. */
	readonly params: Readonly<Record<string, unknown>>;
	/** The live session: its leased, policy-guarded surface, run log, evidence store and manifest. */
	readonly session: ReplaySession;
	/**
	 * The session's redactor (the one its run log redacts with). Replay seeds it with the sensitive params, each
	 * resolved credential and each extracted sensitive output, so every sink masks them.
	 */
	readonly redactor: Redactor;
	/** The app origin the session targets (after env expansion), recorded in `run_started`. */
	readonly origin: string;
	/**
	 * The app profile: its default condition rules apply after the artifact's own (artifact rule → profile →
	 * catalog default); its known dialogs are settled as configured (step 38).
	 */
	readonly profile?: AppProfile;
	/** Resolves the artifact's `credentialRef` at run time. */
	readonly credentials: CredentialProvider;
	readonly options?: ReplayOptionsInput;
	readonly clock?: Clock;
}

type ArtifactCheck =
	| { readonly kind: 'valid'; readonly artifact: CapabilityArtifact }
	| { readonly kind: 'invalid'; readonly error: ReplayError };

/** Parses the artifact with the schema and verifies its contentHash (over the parsed document). */
async function checkArtifact(document: unknown): Promise<ArtifactCheck> {
	const parsed = CapabilityArtifactSchema.safeParse(document);
	if (!parsed.success) {
		return {
			kind: 'invalid',
			error: new ReplayError('artifact_invalid', {
				step: null,
				expected: 'a capability artifact valid against the schema',
				observed: describeIssues(parsed.error.issues),
			}),
		};
	}
	if ((await computeContentHash(parsed.data)) !== parsed.data.contentHash) {
		return {
			kind: 'invalid',
			error: new ReplayError('artifact_invalid', {
				step: null,
				expected: 'contentHash to match the artifact content',
				observed: 'contentHash mismatch: the artifact was modified after it was hashed',
			}),
		};
	}
	return { kind: 'valid', artifact: parsed.data };
}

/** Zod issue paths and codes only: never the offending (possibly sensitive) values. */
function describeIssues(issues: readonly { readonly path: readonly PropertyKey[]; readonly code: string }[]): string {
	return issues
		.slice(0, 10)
		.map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.code}`)
		.join('; ');
}

/** Adds every value the caller supplied for a sensitive param to the redactor, valid or not. */
function seedSensitiveParams(
	artifact: CapabilityArtifact,
	params: Readonly<Record<string, unknown>>,
	redactor: Redactor,
) {
	for (const spec of artifact.params) {
		const value = params[spec.name];
		if (!spec.sensitive || (typeof value !== 'string' && typeof value !== 'number')) continue;
		redactor.addSensitiveValue({ value, paramName: spec.name });
	}
}

/**
 * Replays a capability artifact deterministically — no model anywhere in the decision loop (invariant 1) — and
 * returns `success | business_outcome | failure` (invariant 4). It never throws for run-level problems: an
 * invalid artifact, invalid params, a policy denial, an unresolved target, a checkpoint that does not hold or an
 * invalid output all end as a `failure` result. It throws only for caller errors (`ReplayOptionsError`) and bugs.
 *
 * 1. Parse the artifact and verify its `contentHash` (`artifact_invalid`).
 * 2. Validate the params (`invalid_params`) — before any surface call (AC8).
 * 3. Seed the redactor with the sensitive param values.
 * 4. Run the steps (`StepRunner`), each through the leased, policy-guarded surface, each checkpoint verified and
 *    raced against the step's runtime-condition rules (a business outcome ends the run cleanly); an irreversible
 *    step goes through the approval gate, and an escalating hard failure goes to a human (step 34).
 * 5. Verify the `successCondition` (the `any_step` rules watching).
 * 6. Parse and validate the outputs (`output_invalid`).
 * 7. Build the result; log `result`, write `result.json` (redacted) and the manifest.
 *
 * @throws ReplayOptionsError when an option is out of its bounds (a caller error, before anything runs).
 */
export async function replay(input: ReplayInput): Promise<RunResult> {
	const options = resolveReplayOptions(input.options);
	const clock = input.clock ?? systemClock;
	const { session, redactor } = input;
	const results = new ResultBuilder({
		runId: session.runId,
		artifact: null,
		redactor,
		surface: session.surface,
		evidence: session.evidence,
		clock,
		startedAt: clock.now(),
	});
	const at = () => clock.now().toISOString();

	// 1. The artifact.
	const checked = await checkArtifact(input.artifact);
	const artifact = checked.kind === 'valid' ? checked.artifact : null;
	const ref: ArtifactRef | null =
		artifact === null ? null : { id: artifact.id, version: artifact.version, contentHash: artifact.contentHash };
	results.setArtifact(ref);
	session.runLog.log({
		kind: 'run_started',
		at: at(),
		runId: session.runId,
		actor: 'replay',
		runKind: 'replay',
		artifact: ref,
		goal: null,
		origin: input.origin,
	});

	const finish = async (result: RunResult): Promise<RunResult> => {
		session.runLog.log({
			kind: 'result',
			at: at(),
			runId: session.runId,
			actor: 'replay',
			resultKind: result.kind,
			...(result.kind === 'failure' ? { code: result.reason } : {}),
			...(result.kind === 'business_outcome' ? { code: result.code } : {}),
			durationMs: results.durationMs(),
		});
		if (ref !== null) session.manifest.setArtifact(ref);
		await session.manifest.writeResult(redactResultForSink(result, redactor, artifact?.outputs ?? []));
		await session.manifest.writeManifest({ endedAt: clock.now() });
		return result;
	};
	const fail = async (error: ReplayError, captureEvidence: boolean) =>
		finish(
			await results.failure({
				reason: error.code,
				step: error.step,
				expected: error.expected,
				observed: error.observed,
				...(error.interventionRequestId === undefined ? {} : { interventionRequestId: error.interventionRequestId }),
				captureEvidence,
			}),
		);

	if (checked.kind === 'invalid') return fail(checked.error, false);
	const { artifact: valid } = checked;

	// 2–3. The params: seed the redactor first (even invalid values must not reach a sink), then validate.
	seedSensitiveParams(valid, input.params, redactor);
	const validated = paramsSchemaFor(valid.params).safeParse(input.params);
	if (!validated.success) {
		const error = new ReplayError('invalid_params', {
			step: null,
			expected: `params valid for ${valid.id}@${valid.version}`,
			observed: describeIssues(validated.error.issues),
		});
		return fail(error, false);
	}
	const params: ParamValues = validated.data;
	seedSensitiveParams(valid, params, redactor);

	// 4–6. The steps, the success condition and the outputs.
	const state = new RunState();
	const context: StepContext = {
		runId: session.runId,
		surface: session.surface,
		runLog: session.runLog,
		redactor,
		binder: createValueBinder({ params, credentials: input.credentials, redactor }),
		// Without detectors; the step runner adds each step's condition watch (artifact → profile → catalog).
		verifier: new CheckpointVerifier({ surface: session.surface }),
		options,
		clock,
		outputs: new Map(valid.outputs.map((spec) => [spec.name, spec])),
		state,
	};
	const runner = new StepRunner(context, {
		conditions: {
			artifactRules: valid.outcomeRules,
			profileRules: input.profile?.conditions ?? [],
			knownDialogs: input.profile?.knownDialogs ?? [],
		},
		escalation: session,
	});
	const lastStepId = valid.steps.at(-1)?.id;
	if (lastStepId === undefined) throw new ReplayStateError('a validated artifact has at least one step');
	try {
		const steps = await runner.run(valid.steps);
		if (steps.kind === 'business_outcome') return finish(results.businessOutcome(steps));
		const success = await runner.verifySuccessCondition(valid.successCondition, lastStepId);
		if (success.kind === 'business_outcome') return finish(results.businessOutcome(success));
		const outputs = extractOutputs(state.extractions, valid.outputs);
		return finish(results.success({ outputs, drift: [...state.drift], recoveries: state.recoveries }));
	} catch (error) {
		if (!(error instanceof ReplayError)) throw error;
		return fail(error, true);
	}
}
