# @idp/replay-engine

Deterministic replay of capability artifacts (R3, R3.1). **No LLM is in the decision loop.** Every step acts
through the live session's leased, policy-guarded surface. A checkpoint follows every screen-changing step,
runtime conditions are classified from a fixed catalog, and each run ends as
`success | business_outcome | failure`.

## Quick start

```ts
import { openLiveSession } from '@idp/session';
import { InMemoryCredentialProvider, replay } from '@idp/replay-engine';

const session = await openLiveSession({ policy, redactor, runsRoot: 'runs', runKind: 'replay', origin,
	attended: false, subject: { kind: 'capability', id: artifact.id, version: artifact.version } });
const result = await replay({
	artifact, // unknown JSON: parsed and hash-checked here
	params: { memberId: '12345' }, // synthetic
	session, redactor, origin, profile, // profile: the AppProfile (condition rules + known dialogs)
	credentials: new InMemoryCredentialProvider({ teller: { username: 'teller01', password: 'synthetic-pass-01' } }),
	options: { attended: false },
});
await session.close(); // replay has already written result.json and the manifest
```

## `replay(input: ReplayInput): Promise<RunResult>`

The function does not throw for run-level problems. An invalid artifact, invalid params, a policy denial, an
unresolved target, a failed checkpoint and an invalid output all return a `failure` result. It throws only
`ReplayOptionsError` (a caller error) and bugs. The order of work:

1. Parse the artifact and verify its `contentHash` (`artifact_invalid`).
2. Seed the redactor with the sensitive param values, then validate the params with `paramsSchemaFor`
   (`invalid_params`). Both happen before any surface call.
3. Run the steps (`StepRunner`), verify the `successCondition`, then extract and validate the outputs
   (`output_invalid`).
4. Log `result`, then write `result.json` through `redactResultForSink`, then write the manifest.

`ReplayInput` fields:

| Field         | Meaning                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `artifact`    | The artifact document (`unknown`).                                                                   |
| `params`      | Caller params (CLI strings or typed JSON).                                                           |
| `session`     | A `ReplaySession`: the narrow view of `LiveSession` that replay needs (`surface`, `runLog`, `evidence`, `manifest`, `lease`, `requestApproval`, `escalate`). |
| `redactor`    | The session's redactor. Replay seeds it with sensitive params, resolved credentials and sensitive outputs. |
| `origin`      | The app origin, recorded in `run_started`.                                                           |
| `profile?`    | An `AppProfile`. Its `conditions` and `knownDialogs` apply after the artifact's own rules.            |
| `credentials` | A `CredentialProvider` that resolves the artifact's `credentialRef`.                                 |
| `options?`    | A `ReplayOptionsInput` (see below).                                                                  |
| `clock?`      | A test seam.                                                                                         |

### `ReplayOptions` (`DEFAULT_REPLAY_OPTIONS`, `resolveReplayOptions`)

Every option is an integer. An option outside its bounds throws `ReplayOptionsError`.

| Option                    | Default   | Bounds        | Meaning                                                     |
| ------------------------- | --------- | ------------- | ----------------------------------------------------------- |
| `attended`                | `false`   | —             | Approvals and takeovers wait for an operator.               |
| `stepTimeoutMs`           | 10 000    | 1–300 000     | Resolve + act bound when the step has no `timeoutMs`.        |
| `checkpointTimeoutMs`     | 10 000    | 1–300 000     | Checkpoint bound when the checkpoint has no `timeoutMs`.     |
| `slowLoadBudgetMs`        | 15 000    | 1–300 000     | Slow-load wait, counted from the action.                    |
| `retry.max`               | 2         | 0–5           | Failed-load retries per step (ceiling for rules).           |
| `retry.backoffMs`         | 500       | 0–30 000      | Backoff before a retry (ceiling for rules).                 |
| `maxDialogDismissPerStep` | 1         | 0–3           | Known dialogs settled per step.                             |
| `maxReauthPerRun`         | 1         | 0–3           | Re-authentications per run.                                 |
| `approvalTimeoutMs`       | 300 000   | 1–3 600 000   | How long an approval or takeover waits for an operator.     |

## Credentials

- `CredentialProvider` is a port: `resolve(ref) → Promise<Credential>` (`{ username, password }`). It throws
  `CredentialNotFoundError` for an unknown ref. The artifact holds only the ref. Each ref is resolved once per
  run and added to the redactor at once.
- `InMemoryCredentialProvider(map)` is for tests and demos with synthetic credentials (`resolveCalls` counts
  calls).
- `createValueBinder({ params, credentials, redactor }) → ValueBinder` and `paramBindings(params)` produce the
  `{{placeholder}}` bindings and concrete step values.

## Runtime conditions

The catalog is `CONDITION_CATALOG` in `src/conditions/ConditionCatalog.ts`. It is the registration point for
`define-runtime-condition` (touch point 3). A condition's class is resolved **artifact rule → app profile
→ catalog default** (`resolveRules`, `resolveCondition`, `classifyCondition`). An artifact rule overrides the
profile rule with the same code everywhere, and its scope says where the rule is checked. Profile
`knownDialogs` become extra recoverable dialog rules (`knownDialogRules`). A code that none of these sources
knows makes the run fail loudly with `checkpoint_failed` ("has no rule at this step"). The engine never guesses a class.

| Code                  | Default class      | Detector        | Response                                                        | Budget                            |
| --------------------- | ------------------ | --------------- | --------------------------------------------------------------- | --------------------------------- |
| `member_not_found`    | business_outcome   | signature       | stop, return `business_outcome{code, message}`                   | 0                                 |
| `validation_rejected` | business_outcome   | signature       | stop, return the outcome                                         | 0                                 |
| `permission_denied`   | business_outcome   | signature       | stop, return the outcome                                         | 0                                 |
| `known_dialog`        | recoverable        | native_dialog   | settle as the rule says, then re-verify the checkpoint           | `maxDialogDismissPerStep` / step  |
| `slow_load`           | recoverable        | load_timing     | one bounded wait for the checkpoint (logged as `retry` 1/1)      | 1; past `slowLoadBudgetMs` → `failed_load` |
| `failed_load`         | recoverable        | signature (5xx) | backoff, reload the entry route, re-run steps up to the failed one | min(rule, `retry.max`) / step  |
| `session_timeout`     | recoverable        | signature       | re-run the login steps, then the main steps up to the failed one | `maxReauthPerRun`; exhausted → `session_lost` |
| `unknown_dialog`      | failure (escalates)| native_dialog   | leave the dialog unaccepted, fail                                | 0                                 |
| `app_error`           | failure (escalates)| signature       | fail with evidence                                               | 0                                 |
| `target_unresolved`   | failure (escalates)| locator         | fail with evidence                                               | 0                                 |
| `checkpoint_failed`   | failure (escalates)| checkpoint      | fail with evidence                                               | 0                                 |

A recovery budget that runs out ends the run as `recovery_exhausted` (or `session_lost` after re-auth), never
as an outcome. A retry never runs for an irreversible step or re-runs one before it. A re-auth is refused once an irreversible step has run. A rule can lower the retry
count or backoff, but never raise them above `ReplayOptions`. `failureReasonFor(code)` maps a `failure`-class
code to its `FailureReason`: its own code, the nearest reason for a recoverable code that was declared a failure,
or `app_error` for an app-specific code.

Condition exports: `CONDITION_CATALOG`, `CONDITION_CODES`, `catalogEntry`, `shouldEscalate`,
`detectConditions` / `matchSignature` (a pure signature matcher over an `Observation`), `resolveRules`,
`resolveCondition`, `classifyCondition`, `knownDialogRules`, `ConditionWatch` / `UNKNOWN_DIALOG` (the per-step
detector), `respondToCondition` (outcome | recovery plan | thrown failure) and `failureReasonFor`. Recovery
exports: `StepRecovery` (per-step budgets), `dismissKnownDialog`, `waitForSlowLoad` / `FAILED_LOAD` and
`logRecovery`.

## Steps and checkpoints

- `StepRunner` runs the per-step loop. It pre-observes the page, runs the handler, races the checkpoint against
  the condition watch, and then settles any condition. Handlers live in `src/steps/handlers/<kind>.ts` and are
  dispatched by `dispatch` in `StepRunner.ts`. This is **define-action touch point 4**. A handler binds
  values, acts through the guarded surface with `performAction` / `actionBase` (policy runs inside the guard
  before the action), and then calls `verifyCheckpoint`.
- `CheckpointVerifier` runs a bounded `check` raced against a `ConditionDetector`. `describeCheckpoint`
  produces the text used in expected/observed. `RunState` holds extractions, drift (a locator rung above 0) and
  recoveries.
- `extractOutputs` / `parseExtracted` parse `text | decimal | integer` values and then validate them with
  `outputsSchemaFor` (`OutputParseError` → `output_invalid`).

## Escalation (`src/escalation/`)

- `handleApproval` runs when the guard refuses an irreversible step with `ApprovalRequiredError`. It calls
  `session.requestApproval`, and the session reacquires the lease itself on approval. On `granted`, the same
  step is retried once with the single-use grant. `rejected` → `approval_rejected`, `timeout` → `timeout`,
  `aborted` → `human_aborted`, and unattended → `approval_required`. Every failure carries the
  `interventionRequestId`.
- `handleHardFailure` runs for escalating failures (`shouldEscalate`: `target_unresolved`,
  `checkpoint_failed`, `unknown_dialog`, `app_error`), at most once per step. It calls `session.escalate`. On
  `resumed`, it re-verifies the step's checkpoint on the live screen, then calls `lease.reacquire()`, then
  continues. A read-only step without a checkpoint (`extract`, `wait`) is re-run. A checkpoint that does not
  hold gives `checkpoint_failed`. Unattended runs return the original failure with the persisted request ref.

## Results

- `ResultBuilder` builds the `RunResult`. A failure captures masked evidence: a masked screenshot and the
  redacted a11y snapshot.
- `redactResultForSink(result, redactor, outputs)` makes the copy written to `result.json`. It redacts free
  text (`message`, `expected`, `observed`) and output values, fully masks sensitive outputs, and keeps
  structural fields verbatim.

## Errors

`ReplayError` has `code` = a `FailureReason`, `step`, `expected`, `observed` and `interventionRequestId?`.
`toReplayError` maps surface and session errors to a reason. The other typed errors are `ReplayOptionsError`,
`ReplayStateError` (an internal invariant broke), `CredentialNotFoundError` and `OutputParseError`.

## Known limits

- **`unknown_dialog` has no screenshot.** Chromium cannot screenshot or read the DOM behind a pending native
  dialog, and replay never settles a dialog it was not told to. The failure carries only the redacted
  blocked-page a11y snapshot, and the note in `observed` says so. No screenshot ref is faked.
- **`slow_load` is a heuristic.** Only a `navigate` / `click` / `press` that used its whole bound
  (`step.timeoutMs ?? stepTimeoutMs`) and whose checkpoint does not hold yet counts as slow. A slow load that
  finishes inside the step bound never shows up as one.
- In-place recoveries (dismiss, wait) are not nested inside a retry or re-auth re-run. A condition that needs
  one there ends the run as `recovery_exhausted`.

## Tests

```bash
pnpm --filter @idp/replay-engine test              # unit (fakes, no browser), incl. src/noLlmBoundary.test.ts
pnpm --filter @idp/mock-bank build                 # functional tests start apps/mock-bank/dist
pnpm --filter @idp/replay-engine test:functional   # replayMemberLookup, approvalAndHandoff, conditions/*
```

`src/noLlmBoundary.test.ts` reads the real workspace manifests. It asserts that the transitive runtime closure
of this package contains neither `@idp/agent` nor `@anthropic-ai/sdk`, and that no source file imports either
one (AC5, R3.1). A negative control proves that the check can fail.
