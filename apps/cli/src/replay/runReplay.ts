import type { CapabilityArtifact, RunResult } from '@idp/artifact-schema';
import { createRedactor, type Redactor } from '@idp/policy';
import { replay, type CredentialProvider } from '@idp/replay-engine';
import { openLiveSession, type LiveSession } from '@idp/session';
import type { LoadedConfig } from '../config/loadConfig.js';

/** Input of `runReplay`: the artifact, CLI params, config, credentials and session options. */
export interface RunReplayInput {
	/** The artifact document as read (re-parsed and hash-checked by the engine). */
	readonly document: unknown;
	/** The same artifact, schema-parsed (for the session subject and the output specs). */
	readonly artifact: CapabilityArtifact;
	/** CLI strings; the engine validates and coerces them (`invalid_params`). */
	readonly params: Readonly<Record<string, string>>;
	readonly config: LoadedConfig;
	readonly credentials: CredentialProvider;
	/** Values to seed into the run's redactor up front (e.g. the env credentials). */
	readonly sensitiveValues: readonly string[];
	readonly runsRoot: string;
	readonly attended: boolean;
	readonly headed: boolean;
	readonly controlPort?: number;
	/** Called once the session is open, before the replay starts (attended: print the control URL). */
	readonly onSessionOpen?: (session: LiveSession) => Promise<void>;
	/** Called after the session closed (attended: remove the control files). */
	readonly onSessionClosed?: (session: LiveSession) => Promise<void>;
}

/** What `runReplay` returns: the in-memory result (real outputs), its redactor and the run dir. */
export interface ReplayRun {
	readonly result: RunResult;
	/** The run's redactor: seeded by the engine with sensitive params, credentials and extracted outputs. */
	readonly redactor: Redactor;
	readonly runDir: string;
}

/**
 * One deterministic replay, wired as the demo path runs it: a live session (run kind `replay`, policy-guarded,
 * redacting sinks) → `@idp/replay-engine` `replay` → close. No model anywhere (invariant 1): this module and
 * everything it imports stay clear of `@idp/agent`.
 */
export async function runReplay(input: RunReplayInput): Promise<ReplayRun> {
	const { artifact, config } = input;
	const redactor = createRedactor({ config: config.policy, sensitiveValues: [...input.sensitiveValues] });
	const session = await openLiveSession({
		policy: config.policy,
		redactor,
		runsRoot: input.runsRoot,
		runKind: 'replay',
		origin: config.origin,
		headless: !input.headed,
		attended: input.attended,
		...(input.attended && input.controlPort !== undefined ? { controlPort: input.controlPort } : {}),
		subject: { kind: 'capability', id: artifact.id, version: artifact.version },
	});
	let result: RunResult;
	try {
		await input.onSessionOpen?.(session);
		result = await replay({
			artifact: input.document,
			params: input.params,
			session,
			redactor,
			origin: config.origin,
			profile: config.profile,
			credentials: input.credentials,
			options: { attended: input.attended },
		});
	} catch (error) {
		try {
			await closeSession(session, input);
		} catch (closeError) {
			throw new AggregateError([error, closeError], 'the replay failed and the session did not close cleanly', {
				cause: closeError,
			});
		}
		throw error;
	}
	await closeSession(session, input);
	return { result, redactor, runDir: session.runDir.path };
}

async function closeSession(session: LiveSession, input: RunReplayInput): Promise<void> {
	await session.close();
	await input.onSessionClosed?.(session);
}
