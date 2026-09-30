# Implementation Plan — Review Fixes

> Source spec: `./spec.md` (branch `feature/review-fixes`, PoC: Mos Fard, requirements: R1.2, R2.5, R3.2,
> R3.3, R4.1, R4.2, R4.3, R5.1, R6.1–R6.4, R-REAL, D1–D3).

## Context

`computer-use-automation-system` has shipped. A pre-submission review of the whole system found no missing
requirement, but it did find four kinds of problem. First, a safety hole: the headed browser let a person click
and type unrecorded while the automation or a pending approval held the lease. Second, bugs: unbounded
takeovers, the operator console had no authentication, boolean outputs, dead-end counting, model-call failures,
negative checkpoints on unreadable frames, and redaction that corrupted digests. Third, missing tests. Fourth,
docs and evidence that overstate the code. This plan fixes those in place. It adds no new action kind and no new
workspace.

This plan is written **after the fact**. The spec is already marked `Done` and the working tree on
`feature/review-fixes` holds the implementation. The plan records what was built, file by file, so the SDD
trail (spec → plan → code → test → evidence) is complete. It also calls out two places where the code
deliberately differs from the spec's wording (FR5, FR7; see "Open items").

## Approach

Fixes follow the dependency direction. Contracts come first: an optional run-log field (FR10). Then the pure
core: redaction 1.2.0 (FR13) and a sink rule in evidence. Then the surface: the lock and capture modes (FR1/FR2),
the bounded ladder and unreadable checkpoints (FR11), and effective risk. Then the target: two new faults. Then
session and replay: the automation gate, bounded takeover and expiry (FR3), and risk-aware recovery. Then the
agent: FR6–FR10. Then the apps: FR4, FR5, FR7 and FR9 at the CLI. Docs and evidence come last (FR14).

Key decisions:

- **Lock by default.** The attended window starts locked. Every human input is blocked unless the lease is
  `HUMAN`. The automation opens the lock for exactly one act, through an innermost `AutomationGateSurface`.
  This extends ADR-0006.
- **Two waits instead of one.** The approval timeout bounds only the wait for a claim. A claim re-arms the
  timer with a separate takeover bound. An expired request is hidden and refuses every transition.
- **The console gets its own key.** Its credential is a one-time login key exchanged for an `HttpOnly` cookie,
  not the control token. The token never enters a URL or the browser.
- **Boolean outputs are refused.** They are refused at the tool schema, the compiler and the CLI rather than
  compiled into an unsupported extraction.
- **`modelResponse` is additive.** It is an optional run-log field that does not bump the artifact
  `SCHEMA_VERSION`, because the artifact document is unchanged (see Contract impact).

The console-key and takeover-bound choices should be recorded with `/define-adr`, either as an amendment to
ADR-0006 or as a new ADR-0010 (step 20).

Deferred: persisting the `expired` status in the intervention contract, a separate version for run-log
contracts, a multi-login console, and a CLI-driven takeover evidence run (it still uses `driver.mjs`).

## Implementation steps

### 1. Phase 2 — artifact-schema: optional `modelResponse` on the run-log `decision` entry (FR10)

Skill: define-schema (no `SCHEMA_VERSION` bump; see Contract impact)

Modify:

- `packages/artifact-schema/src/evidence/RunLogEntry.ts`: add a private strict `ModelResponseSchema` and a
  `TokenCountSchema` (an int ≥ 0). `DecisionSchema` gains an optional `modelResponse` with five fields:
  - `responseId`: an id pattern, 1–128 characters of `[A-Za-z0-9_-]`.
  - `model`: a model-id pattern.
  - `stopReason`: a lower-case enum-like pattern.
  - `usage`: a strict object with `inputTokens`, `outputTokens`, `cacheReadInputTokens` and
    `cacheCreationInputTokens`.
  - `latencyMs`: an int ≥ 0.

  The patterns allow ids, enums and counts only. No field can carry free text, which is what makes step 3 safe.
- `packages/artifact-schema/schemas/run-log-entry.schema.json`: regenerate it (`additionalProperties: false`,
  all five fields required inside the block).
- `packages/artifact-schema/CHANGELOG.md`: add an "Unreleased — run-log decision metadata" entry. It records
  that the change is additive and optional, needs no migration, and deliberately leaves `SCHEMA_VERSION` unbumped.

### 2. Phase 3 — policy: redaction rules 1.2.0 (FR13)

Skill: TDD

Modify:

- `packages/policy/src/redaction/createRedactor.ts`: add two protected spans.
  - `HEX_DIGEST` matches `sha256:` plus 8 or more hex characters, or a standalone run of 32 or more hex
    characters that contains a letter.
  - `URL_AUTHORITY` matches the http(s) scheme, host and port. The host must contain a letter or a dot, and
    userinfo is excluded.

  Pass them to `outsideProtected`, so config **patterns and terms** skip them. **Known sensitive values are
  still masked inside them.** Known values that are name-like (`ALPHABETIC_VALUE`) now match
  case-insensitively at letter/digit boundaries, keyed by lower case. Values with a digit edge match at digit
  boundaries. All other values keep case-sensitive substring matching.
- `packages/policy/src/redaction/defaultRedactionRules.ts`: bump `REDACTION_RULES_VERSION` from `1.1.0` to
  `1.2.0`.
- `packages/policy/CLAUDE.md`, `packages/policy/README.md`, `config/README.md`: document 1.2.0.

### 3. Phase 3 — evidence: keep `modelResponse` verbatim in the run log (FR10)

Skill: TDD

Modify:

- `packages/evidence/src/runlog/redactRunLogEntry.ts`: add `modelResponse` to `STRUCTURAL_KEYS`. Without it,
  5-digit token counts and latencies would match the member-number pattern. Keeping the block verbatim is safe
  only because step 1 pins every field to an id, enum or count format.

### 4. Phase 4 — surface: capture modes, lock and settle for human input (FR1, FR2)

Skill: glue (the human-recorder part of `define-action`; no new action kind)

Modify:

- `packages/surface/src/recorder/captureScript.ts`:
  - Replace `enabled` with `CaptureMode` = `off | block | record`, and replace the `enable` command with
    `configure`, which carries `automation` and `blockMessage`. Add a `settle` command that carries
    `accepted`.
  - `block`: block trusted pointer, mouse, click, key, input, change, paste, cut, drop and dragstart events
    unless `automation` is on. Show a throttled banner (`#idp-refusal-banner`). Untrusted events pass, and
    `submit` is not blocked, so script `requestSubmit()` still works.
  - `record`: stop a `<select>`'s input/change before the page's `onchange`, and replay it only through the
    pass. Store the prior value on `focusin`. `settle` reverts a refused value.
- `packages/surface/src/recorder/HumanActionRecorder.ts`:
  - Add `lock({ message? })`, `automationAct(run)`, `isLocked`, an exported `DEFAULT_BLOCK_MESSAGE` and the
    option `dialogPending`.
  - Replace the per-start init script with one serialized reconfigure path. It registers the new init script
    before disposing the old one and rotates the secret. While a native dialog is pending, it retries every
    100 ms.
  - `stop()` returns to `block` if the recorder is locked, otherwise to `off`.
  - Call `settleValue` after each fill/select verdict.
- `packages/surface/src/index.ts`: re-export `DEFAULT_BLOCK_MESSAGE` (a gap found while writing this plan).

### 5. Phase 4 — surface: bounded ladder wait, unreadable checkpoints, effective risk (FR11)

Skill: TDD

Create / Modify:

- `packages/surface/src/locators/LadderResolver.ts`:
  - Replace the fixed two attempts with a polling `resolve(target, bindings, timeoutMs?)`. Backoff starts at
    100 ms, grows ×1.5 and is capped at `MAX_BACKOFF_MS` (250).
  - Export `DEFAULT_LADDER_TIMEOUT_MS` (100). A timeout of 0 means a single pass.
  - Each pass walks the ladder in order, and the error reports the last pass's counts.
- `packages/surface/src/playwright/WebSurface.ts`:
  - Export `RESOLVE_TIMEOUT_MS` (5 000), used by `describe` and `resolve`.
  - An act waits at most the smaller of its own timeout and the bound.
  - `check` uses a single pass, because it already polls.
- `packages/surface/src/playwright/evaluateCheckpoint.ts`: add an internal `unreadable` leaf result.
  `text_absent` and `element_absent` never hold on a gone frame, an unresolved scope, or an errored count. The
  result is `not_held` with `frame unreadable: <reason>`. `text_present` still holds from any readable frame.
- `packages/surface/src/playwright/frameReads.ts` (new): `FrameTextRead`, `readFrameText`, `titleOrEmpty` and
  `firstLine`. Only gone-frame errors are tolerated; anything else is rethrown.
- `packages/surface/src/port/ActOutcome.ts`: add the optional `risk`. `packages/surface/src/guard/PolicyGuardedSurface.ts`
  returns the verdict's risk on every allowed outcome.
- `packages/surface/src/errors/TargetNotResolvedError.ts`: doc only.

### 6. Phase 4 — surface: remove every empty `catch {}` (FR13)

Skill: glue

Modify:

- `resolveRoute.ts`, `FrameResolver.ts`, `networkGuard.ts`, the route reading in `evaluateCheckpoint.ts`, and
  `testing/launchMockBank.ts` (listening-line parse): use `URL.canParse` instead of try/catch.
- `actions/raceDialogs.ts`: use a named, observed catch with a comment.
- `playwright/NavigationTracker.ts`: check `request.serviceWorker()` and rethrow any other error.
- `playwright/captureFrames.ts`: add `ariaSnapshotOrNull`, which tolerates only a timeout or a gone frame.
- `testing/launchMockBank.ts` (health wait): tolerate only a `TypeError`.
- `internal/isGoneFrameError.ts`: add the patterns "Frame has been detached" and "Cannot find context with
  specified id".
- Repo config: add `.runs` to `.prettierignore` and `.runs/**` to the ignores in `eslint.config.js`, so raw run
  directories don't fail `lint` or `format:check`.

### 7. Phase 4 — mock-bank: `late_render` and `wrong_screen` faults (FR11, FR12)

Skill: define-mock-screen (fault switches)

Create / Modify:

- `apps/mock-bank/src/faults/faultCodes.ts`: add two `once` faults.
  - `late_render` on `/member/search`.
  - `wrong_screen` on `/member/detail`.
- `apps/mock-bank/src/screens/memberSearch.ts`: add `LATE_RENDER_DEFAULT_MS` (1 500) and a `lateButtonMs`
  option. An inline timer writes the Search button into the last form cell after the delay, honouring
  `delayMs`.
- `apps/mock-bank/src/screens/accountSummary.ts` (new): `accountSummaryScreen()`. A plausible "Account Summary"
  page with HTTP 200 and no error text, so no condition detector fires and only the checkpoint catches it.
- `apps/mock-bank/src/routes/member.ts`: wire both faults. `late_render` is skipped when `control_missing`
  fires. `wrong_screen` runs after validation and before the member lookup.
- `apps/mock-bank/src/faults/parseFaultSpec.ts`, `apps/mock-bank/src/server.ts`, `apps/mock-bank/README.md`:
  comments and the fault table.

### 8. Phase 5 — session: automation gate and lock in attended sessions (FR1)

Skill: glue

Create / Modify:

- `packages/session/src/lease/AutomationGateSurface.ts` (new): a `Surface` decorator plus the
  `AutomationGate` interface. It wraps each `agent`/`replay` act in `automationAct`. A `human` act passes
  through and never opens the gate. Every other method delegates.
- `packages/session/src/LiveSession.ts`:
  - The automation stack becomes `LeasedSurface(guard(AutomationGateSurface(web, recorder)))`.
  - One shared `HumanActionRecorder` is built with `dialogPending`.
  - Attended sessions call `recorder.lock()` **before** `ControlServer.start`.
- `packages/session/src/index.ts`: export the gate, `AutomationGate` and `AwaitResolutionOptions`.

### 9. Phase 5 — session: bounded takeover and expiry (FR3)

Skill: TDD

Modify:

- `packages/session/src/intervention/InterventionService.ts`:
  - `awaitResolution(id, { timeoutMs, claimedTimeoutMs })`. `claim()` re-arms each waiter's timer with
    `claimedTimeoutMs`. A generation counter discards stale timers, and expiry runs inside `serialize()`.
  - An expired entry is hidden from `list()`. It refuses every transition with a conflict whose `problem` is
    `expired`, and awaiting it again rejects immediately. `resume` and `abort` skip it.
  - Expiry is in memory only (see Open items).
- `packages/session/src/errors/InterventionConflictError.ts`: `problem` gains `expired`. The code stays
  `INTERVENTION_CONFLICT` (409).
- `packages/session/src/LiveSession.ts`:
  - Add `DEFAULT_TAKEOVER_TIMEOUT_MS` (30 min) and a `takeoverTimeoutMs` option on the session and on each
    call.
  - The escalation `timeout` outcome gains `stage: unclaimed | takeover`.
- `packages/session/src/control/ControlServer.ts`: only a `SyntaxError` from the body parse becomes 400
  `BAD_REQUEST`, carrying the cause. Other errors propagate as 500 (FR13).

### 10. Phase 5 — replay-engine: takeover bound, risk-aware recovery, strict resume (FR3, FR11)

Skill: TDD

Modify:

- `packages/replay-engine/src/ReplayOptions.ts`: add `takeoverTimeoutMs`, default 1 800 000 ms, bounded to
  1–14 400 000. `approvalTimeoutMs` now bounds only the wait for a claim.
- `packages/replay-engine/src/escalation/handleHardFailure.ts`:
  - Pass both bounds, and word the timeout message by stage.
  - Resuming on a mutating step that has no checkpoint now requires at least one non-refused human action.
    Otherwise it fails `checkpoint_failed` without reacquiring. Read-only steps re-run as before.
- `packages/replay-engine/src/steps/performAction.ts`: `effectiveRisk(step, context)` is the highest of three
  risks, via `maxRisk`: the declared risk, the guard's `ActOutcome.risk`, and earlier attempts. The action log
  records it.
- `packages/replay-engine/src/steps/RunState.ts`: add the `effectiveRisk` map.
- `packages/replay-engine/src/steps/StepRunner.ts`:
  - Every irreversible check (the failed step, the retry prefix, the reauth prefix) uses the effective risk.
  - `recordCheckpointBefore` makes one single-poll check before the first attempt, but only when condition
    rules exist.
  - `reload()` counts a step as done from its checkpoint only when that checkpoint did not already hold before
    the step.
- `packages/replay-engine/src/recovery/StepRecovery.ts`: add `checkpointHeldBefore`.
- `packages/replay-engine/src/conditions/respondToCondition.ts`: wording only.

### 11. Phase 5 — agent: policy-denial escalation and distinct-screen dead ends (FR6, FR8)

Skill: TDD

Modify:

- `packages/agent/src/loop/DiscoveryLoop.ts`:
  - When the denial counter trips, call `#askForHelp` with the trigger `policy_blocked` and the detail
    "N consecutive policy denials; last: …".
  - If the operator resumes, the loop continues. If no operator answers, it stops with `policy_blocked` and
    sets `interventionRequestId`.
  - `recordAction` is told whether the action was value-only (fill or select).
- `packages/agent/src/loop/StopConditions.ts`:
  - `dead_end` trips after `deadEndRepeats` (3) consecutive turns that leave the screen unchanged. Value-only
    actions neither count nor reset. A screen change resets the count.
  - The window keeps distinct consecutive screens, only for the A-B-A-B oscillation check.
  - Add `ActionRecord.valueOnly` and `remainingMs()`.

### 12. Phase 5 — agent: model-call bounds, failure result and response metadata (FR9, FR10)

Skill: TDD

Modify:

- `packages/agent/src/model/ModelClient.ts`: add `ModelCallOptions` with `signal` and `timeoutMs`, and change
  the signature to `next(request, options?)`.
- `packages/agent/src/model/ModelTurn.ts`: add `ModelResponseInfo` (id, model, stopReason) as
  `ModelTurn.response`.
- `packages/agent/src/model/AnthropicModelClient.ts`:
  - Add `DEFAULT_TIMEOUT_MS` (120 000). Pass `signal`, and a timeout equal to the smaller of the remaining
    budget and the configured value, as the SDK request options.
  - Map the response id, model and raw `stop_reason` into `response`.
- `packages/agent/src/model/ScriptedModel.ts`: emit synthetic metadata (`scripted-<n>`, zero usage). The
  end-of-script path also counts a call.
- `packages/agent/src/loop/DiscoveryLoop.ts`:
  - `#callModel` races each call against an abort timer set to the remaining budget. Running out of budget
    stops with `timeout`. A `ModelCallError` stops with `model_error` and records `retryable`. Any other error
    is rethrown.
  - `modelResponseOf` builds the `decision.modelResponse`. It measures latency on the injected clock and
    normalizes values that fail the formats.
- `packages/agent/src/loop/DiscoveryOutcome.ts`: add `model_error` to `STOP_REASONS` and `retryable` to
  `stopped`.
- `packages/agent/src/DiscoveryRunner.ts`: map `model_error` to the `recovery_exhausted` failure reason, which
  writes a `failure` result without a contract change.

### 13. Phase 5 — agent: refuse boolean outputs; stronger reasons (FR7, FR14)

Skill: TDD

Modify:

- `packages/agent/src/tools/toolInputSchemas.ts`:
  - `declare_output.type` drops `boolean`.
  - Export `MIN_REASON_LENGTH` (15). `reason` is trimmed and must be at least that long, and the error message
    tells the model how to fix it.
- `packages/agent/src/compiler/ArtifactCompiler.ts` and `packages/agent/src/errors/ArtifactCompileError.ts`:
  add `EXTRACTABLE_OUTPUT_TYPES`. A boolean output throws with the new code `UNSUPPORTED_OUTPUT_TYPE`.
- `packages/agent/src/prompt/systemPrompt.ts`: Rule 2 now asks for a reason drawn from what was observed.

### 14. Phase 5 — agent: session hooks for attended discovery (FR4)

Skill: glue

Modify:

- `packages/agent/src/DiscoveryRunner.ts`:
  - Add the options `onSessionOpen` and `onSessionClosed`, and export `DiscoverySessionInfo` (`runId`,
    `runDir`, `controlUrl`, `controlToken`).
  - `onSessionOpen` runs inside the try, so a throw closes the session and fails the run. `onSessionClosed`
    runs after `session.close()` on both paths.
- `packages/agent/src/index.ts`: export `DiscoverySessionInfo`, `ModelCallOptions`, `ModelResponseInfo` and
  `MIN_REASON_LENGTH`.

### 15. Phase 6 — cli: attended discovery, boolean refusal, model-error exit, display paths (FR4, FR7, FR9, FR14)

Skill: TDD

Create / Modify:

- `apps/cli/src/commands/discover.ts`:
  - `--attended` wires the session hooks. On open, `announceControl` seeds the redactor with the token,
    writes the control files, and prints the control URL, the token-file path and the `pnpm idp operator`
    line. On close, it removes the files.
  - `--output x:boolean` is a `CliUsageError` (exit 64).
  - A stop with `model_error` prints a transient or not-retryable message and exits 1.
- `apps/cli/src/cli/CliContext.ts`: add `displayPath`, which prints a path relative to the invocation
  directory when it lies under it. `catalog.ts`, `discover.ts` and `replay.ts` use it for every printed path.
- `apps/cli/src/replay/attendedWarning.ts` (new): warns when `--attended` runs without `--headed`, because
  then only approve, reject and abort are possible, with no takeover. `replay.ts` prints it to stderr and
  updates the `--headed` help.
- `apps/cli/CLAUDE.md`: layout map.

### 16. Phase 6 — operator: one-time console key and session cookie (FR5)

Skill: TDD

Create / Modify:

- `apps/cli/src/operator/writeConsoleKey.ts` (new):
  - Exports `CONSOLE_KEY` (`operator.key`), `newConsoleKey`, `writeConsoleKey` and `removeConsoleKey`.
  - The key is 40 letters from rejection-sampled `randomBytes`. It uses letters only, so no redaction pattern
    can mask part of the printed URL.
  - The file is written with mode 0600 and the exclusive-create flag.
- `apps/cli/src/commands/operator.ts`: write the key next to the token file, pass `IDP_OPERATOR_KEY` to the
  console, and remove the key in `finally`.
- `apps/operator/src/config.ts`: `loginKey` comes from `IDP_OPERATOR_KEY`. It must match
  `[A-Za-z0-9_-]{32,128}` and must differ from the control token; otherwise `OperatorConfigError` (exit 64).
- `apps/operator/src/server.ts`:
  - Export `SESSION_COOKIE`. `GET /login?k=` compares the key in constant time and accepts it once.
  - A successful login issues a random session cookie (`HttpOnly; SameSite=Strict; Path=/`) and returns 303
    to `/`.
  - Every other route returns 401 `LOGIN_REQUIRED` without calling the session. New codes:
    `LOGIN_REJECTED`, `LOGIN_KEY_USED`.
- `apps/operator/src/main.ts`: print the login URL.
- `apps/operator/README.md`, `apps/operator/CLAUDE.md`: the env table, the route and the authentication
  section.

### 17. Phase 7 — docs: package and root docs (FR14)

Skill: update-docs (per workspace, then root)

Modify:

- The `CLAUDE.md` and `README.md` of `packages/surface`, `packages/session`, `packages/agent` and
  `packages/policy`: document the lock and capture modes, the stack order, bounded waits and expiry, the ladder
  bound, unreadable checkpoints, effective risk, the session hooks, `model_error`, `modelResponse`, and the
  refused boolean type.
- `README.md`:
  - The `--output` types, `discover --attended --headed`, the per-turn metadata, and the `wrong_screen` and
    `late_render` examples.
  - The handoff section: the window lock, the one-time login URL, approve vs. takeover, and the headless
    warning.
  - Exit code 1 now includes a model API error.
- `REPORT.md`: rewrite for density (about 3 pages) under the seven exact headings. Remove internal
  requirement and check IDs, and quote the real discovery goal and the response metadata.
- `docs/adr/0009-redaction-model-and-evidence-sinks.md`: add the paragraph on rules 1.2.0.

### 18. Phase 7 — evidence: recapture under the fixed code (FR14, R-REAL)

Skill: /capture-evidence (needs user confirmation for the real discovery run)

Modify / Create:

- Capture every scenario with `--runs-root .runs/evidence/<scenario>/runs`, so printed paths are relative.
- Recapture:
  - `discovery-member-lookup/`: a real Claude run whose `run.jsonl` carries `modelResponse`, plus
    `verify-replay/`.
  - The replays: success, not-found, injected-failure, recovered-known-dialog and tenant-b-drift.
  - `handoff-open-sub-account/` and `evidence/artifacts/member-lookup.json`.
- Update `artifacts/member-lookup.json`: provenance and hash from the new discovery run.
- Add three scenarios:
  - `replay-member-lookup-checkpoint-failed/` (`wrong_screen`).
  - `replay-member-lookup-recovered-session-timeout/`.
  - `replay-member-lookup-validation-rejected/`.
- `evidence/handoff-member-lookup-takeover/driver.mjs`: derive the repo root from `import.meta.url` (it used
  to hard-code a machine path) and print relative paths. Add `driver-output.txt`.
- Remove the superseded intervention files. Rewrite `evidence/README.md` as one table plus honest notes.

### 19. Phase 7 — design index

Skill: glue

Modify: `_design/index.md` (the Plan cell).

### 20. Phase 7 — ADRs for the two new defendable choices

Skill: /define-adr

Create: either an ADR-0006 amendment or a new `docs/adr/0010-*` covering three things:

- the locked-by-default headed window with the automation gate;
- the separate claim and takeover bounds with in-memory expiry;
- the one-time operator console key in place of the control token.

Then update `docs/adr/README.md`.

## Invariant check

- **No LLM on replay path.** Not touched. Replay changes are deterministic: risk bookkeeping, a checkpoint
  probe and wait bounds. `@idp/replay-engine` gains no agent dependency.
- **Every action through policy.** Tightened. Human input is blocked unless the lease is `HUMAN`. Human
  fill/select is policy-checked before it takes effect, and a refused value is reverted. The automation's own
  acts still go lease → guard → gate → web. No new action kind.
- **Redact before any sink.** Rules 1.2.0 stop corrupting digests and ports, but known values are still masked
  inside them. `modelResponse` is kept verbatim only because its schema allows ids, enums and counts. The
  control token and console key never reach stdout (the token is seeded into the redactor; the key is
  letters-only in a 0600 file).
- **Business outcome ≠ failure.** Kept. `model_error` maps to a `failure`, and a timed-out escalation is a
  `failure` `timeout`. No recoverable condition becomes an outcome.
- **Checkpoints.** Strengthened. Negative checkpoints no longer pass on unreadable frames. A resume without a
  checkpoint needs a real human action. `reload()` no longer counts a checkpoint that already held before the
  step as success.
- **Schema is a public contract.** The artifact contract is unchanged. The run-log `modelResponse` is optional
  and additive. The JSON Schema is regenerated, with tests and a CHANGELOG entry. `SCHEMA_VERSION` is
  deliberately **not** bumped, because it is the literal every artifact embeds (see Open items).
- **Synthetic data only.** Kept. The new mock-bank screens are synthetic. The real discovery run targets the
  local mock-bank, and evidence has no machine paths.

## Critical files

**To create**

- `packages/session/src/lease/AutomationGateSurface.ts`
- `packages/surface/src/playwright/frameReads.ts`
- `apps/mock-bank/src/screens/accountSummary.ts`
- `apps/cli/src/operator/writeConsoleKey.ts`
- `apps/cli/src/replay/attendedWarning.ts`
- `packages/replay-engine/test/functional/conditions/checkpointFailed.test.ts`, plus the new unit and
  functional tests below
- `evidence/replay-member-lookup-{checkpoint-failed,recovered-session-timeout,validation-rejected}/`

**To modify**

- `packages/surface/src/recorder/{captureScript,HumanActionRecorder}.ts`: capture modes, lock, settle (FR1/FR2).
- `packages/session/src/LiveSession.ts` and `intervention/InterventionService.ts`: stack order, lock order,
  takeover bound, expiry (FR1/FR3).
- `packages/surface/src/locators/LadderResolver.ts` and `playwright/{WebSurface,evaluateCheckpoint}.ts`:
  bounded ladder, unreadable frames (FR11).
- `packages/replay-engine/src/steps/{StepRunner,performAction,RunState}.ts` and
  `escalation/handleHardFailure.ts`: effective risk, strict resume, takeover bound (FR3/FR11).
- `packages/agent/src/loop/{DiscoveryLoop,StopConditions,DiscoveryOutcome}.ts`,
  `model/{ModelClient,ModelTurn,AnthropicModelClient,ScriptedModel}.ts` and `DiscoveryRunner.ts` (FR4, FR6,
  FR8–FR10).
- `packages/agent/src/{tools/toolInputSchemas,compiler/ArtifactCompiler}.ts` (FR7).
- `packages/artifact-schema/src/evidence/RunLogEntry.ts` and `schemas/run-log-entry.schema.json` (FR10).
- `packages/policy/src/redaction/{createRedactor,defaultRedactionRules}.ts` (FR13).
- `apps/operator/src/{config,server,main}.ts` and `apps/cli/src/commands/{discover,operator,replay,catalog}.ts`
  (FR4, FR5, FR7, FR9, FR14).
- `README.md`, `REPORT.md`, `evidence/README.md` and ADR-0009 (FR14).

## Test plan

**Unit tests (`pnpm test`; fakes only, no browser, no LLM)**

- `packages/artifact-schema/src/evidence/RunLogEntry.test.ts`: `modelResponse` is accepted; free-text `model`
  and extra keys are rejected (FR10).
- `packages/evidence/src/runlog/RunLog.test.ts`: `modelResponse` with 5-digit counts survives verbatim, while a
  member id in `reason` is still redacted (FR10).
- `packages/policy/src/redaction/createRedactor.test.ts` and `defaultRedactionRules.test.ts`:
  - Digests intact, including truncated ones and the 32-hex threshold.
  - A known value inside a digest is still masked. A URL port is kept while its path and query are masked.
  - Name-like values match case-insensitively at word boundaries. A password stays case-sensitive.
  - The version is 1.2.0 (FR13).
- `packages/surface/src/guard/PolicyGuardedSurface.test.ts`: `outcome.risk` is reversible for a plain click,
  and irreversible when policy raises it (FR11).
- `packages/surface/src/locators/LadderResolver.test.ts`: polls until a late element appears; gives up at the
  bound with the last counts; 0 means a single pass; drift picks a lower rung; waits for a late frame (FR11).
- `packages/surface/src/playwright/evaluateCheckpoint.test.ts`: `text_absent` and `element_absent` are
  unreadable on a gone frame, an unresolved scope or an errored count. `text_present` holds despite an
  unreadable frame. A real error is thrown. `all_of` reports the unreadable leaf (FR11).
- `packages/surface/src/internal/isGoneFrameError.test.ts`: the gone-frame patterns match; any other error
  does not (FR13).
- `packages/session/src/lease/AutomationGateSurface.test.ts`: an automation act opens and closes the gate once;
  a human act never opens it; other methods delegate (FR1).
- `packages/session/src/intervention/InterventionService.test.ts` (FR3):
  - A timed-out request is expired and unlisted, and a claim returns a conflict with `expired`.
  - An expired approval cannot be approved.
  - A claim re-arms the wait, and a claimed takeover past its bound rejects with the lease still `HUMAN`.
- `packages/replay-engine/src/steps/StepRunner.test.ts` (FR11):
  - A retry is refused when policy raises a step to irreversible, and a raised failed step is never retried.
  - A control case without the raise retries successfully.
  - `reload()` re-executes when the checkpoint held before the step, and counts the step done when it did not.
- `packages/replay-engine/src/escalation/handleHardFailure.test.ts`: separate claim and takeover bounds and
  their stage messages. A resume without a checkpoint and without an allowed human action fails
  `checkpoint_failed` (FR3/FR11).
- `packages/replay-engine/src/ReplayOptions.test.ts` and `ReplayEngine.test.ts`: the `takeoverTimeoutMs`
  default and bound, and the extra pre-step checks.
- `packages/agent/src/loop/DiscoveryLoop.test.ts` (ScriptedModel / FakeModel):
  - FR6: attended denial escalation resumes; unattended stops `policy_blocked` with a request id; abort gives
    `human_aborted`.
  - FR9: a `ModelCallError` gives `model_error` with `retryable`; a foreign error propagates; a hanging call
    gives `timeout` and receives `timeoutMs`; a call that honours the abort gives `timeout`.
  - FR10: the metadata and `latencyMs` taken from the fake clock.
- `packages/agent/src/loop/StopConditions.test.ts`: three no-ops trip `dead_end`; a screen change resets;
  value-only actions don't count (FR8).
- `packages/agent/src/model/AnthropicModelClient.test.ts`: the stop reason mapping, the timeout cap and the
  signal pass-through (FR9/FR10).
- `packages/agent/src/compiler/ArtifactCompiler.test.ts`: boolean gives `UNSUPPORTED_OUTPUT_TYPE` (FR7).
  `packages/agent/src/tools/toolToAction.test.ts`: a short reason is rejected.
- `apps/cli/src/commands/discover.test.ts`: boolean exits 64; `model_error` exits 1; an ordinary stop exits 4;
  control hooks are wired only when attended (FR4/FR7/FR9).
- `apps/cli/src/operator/writeConsoleKey.test.ts`, `apps/cli/src/replay/attendedWarning.test.ts` and
  `apps/cli/src/paths/paths.test.ts` (`displayPath`).
- `apps/operator/src/config.test.ts`: the key is missing, short, has bad characters, or equals the token.
  `apps/operator/src/server.test.ts`: the cookie attributes, the one-time key, every route 401 without a login,
  a forged cookie, a wrong key (FR5).

**Functional tests (`pnpm test:functional`; real mock-bank process + Chromium)**

- `packages/surface/test/functional/captureScript.test.ts`:
  - record: a select is stopped before `onchange`; a refused value is reverted; an allowed one reaches
    `onchange` once.
  - block: trusted gestures are blocked with a banner; untrusted events and automation input pass (FR1/FR2).
- `packages/surface/test/functional/recorder.test.ts`: locked vs unlocked after stop; a refused fill is
  reverted; an allowed select reaches the page once; a refused select never reaches `onchange` (FR1/FR2).
- `packages/surface/test/functional/ladder.test.ts`: `late_render` resolves within the bound; a negative
  checkpoint on a missing frame is `frame unreadable` (FR11).
- `packages/session/test/functional/handoff.test.ts` (FR1, FR3):
  - Input while the automation holds the lease is blocked. A Confirm click or Enter during a `PAUSED`
    approval is blocked and records nothing.
  - A claimed takeover outlives the approval bound. An unclaimed request times out with `stage: unclaimed`
    and is then a 409.
- `packages/replay-engine/test/functional/conditions/checkpointFailed.test.ts`: fault `wrong_screen` gives a
  `failure` `checkpoint_failed` at `s06-click-search`, with an a11y snapshot and a screenshot, and no
  `condition_detected` (FR12).
- `packages/replay-engine/test/functional/conditions/targetAndCheckpoint.test.ts`: `late_render` gives
  `success` with no drift, and rung 0 resolved (FR11).
- `packages/agent/test/functional/discoverMemberLookup.test.ts`: every decision carries a `modelResponse`, and
  digests survive redaction (FR10/FR13). `discoveryStops.test.ts`: `dead_end` after 3 turns; `policy_blocked`
  carries a request id (FR6/FR8).
- `apps/mock-bank/test/functional/faults.test.ts`: `late_render` and `wrong_screen` are each served once.
- `apps/cli/test/functional/discover.test.ts`: boolean exits 64 before a browser starts; `--attended` writes
  the control files and prints the URL but never the token (FR4/FR7).
  `apps/cli/test/functional/cli.test.ts`: `idp operator` prints a login URL; the key file is 0600 and removed;
  the login flow gives 401/401/303 (FR5).
- `apps/operator/test/functional/console.test.ts`: another process gets 401 on read and approve, with the lease
  left `PAUSED`; key reuse gives 401; a missing key exits 64 (FR5).

## Verification

1. `pnpm install`
2. `pnpm build`
3. `pnpm typecheck && pnpm lint && pnpm format:check`
4. `pnpm test`
5. `pnpm setup:browsers && pnpm test:functional`
6. Smoke, after `pnpm mock-bank` is running:
   - `MOCKBANK_FAULTS=wrong_screen` with `pnpm idp replay member-lookup --param memberId=<synthetic>` gives a
     `failure` `checkpoint_failed` at `s06-click-search`.
   - `pnpm idp discover … --output flag:boolean` exits 64.
   - `pnpm idp replay … --attended` (without `--headed`) prints the no-takeover warning.
   - `pnpm idp operator …` prints `/login?k=<40 letters>`, and never the token.
7. `grep -rE "/Users/|/private/|/tmp/|/home/" evidence` finds nothing.

## Evidence

- `evidence/discovery-member-lookup/`: a real discovery run with per-turn `modelResponse`, plus
  `verify-replay/` (`pnpm idp discover --runs-root .runs/evidence/…`, run through `/capture-evidence` after
  user confirmation).
- `evidence/replay-member-lookup-{success,not-found,injected-failure,recovered-known-dialog,tenant-b-drift}/`:
  `pnpm idp replay` with the matching `MOCKBANK_FAULTS` or tenant.
- New: `replay-member-lookup-checkpoint-failed/` (`wrong_screen`), `-recovered-session-timeout/`, and
  `-validation-rejected/` (`memberId=abc`).
- `evidence/handoff-open-sub-account/` comes from `pnpm idp replay --attended`.
  `evidence/handoff-member-lookup-takeover/` comes from `driver.mjs` plus `driver-output.txt`.
- `evidence/artifacts/member-lookup.json` and `artifacts/member-lookup.json`: the recompiled artifact.

## Open items the spec already calls out (no plan change needed)

- **FR5 wording.** The spec says the console "requires the session control token". The code requires a
  separate one-time console key exchanged for a cookie, so the token never enters a URL, browser history or
  the redacted stdout. This is stricter than the wording. Restate FR5 in the spec, or record it in the step 20
  ADR.
- **FR7 wording.** The spec says boolean outputs "compile to a boolean extraction and replay successfully".
  The code instead refuses boolean at the tool schema, the compiler (`UNSUPPORTED_OUTPUT_TYPE`) and the CLI
  (exit 64), because no extraction handles it. The spec should be restated to "boolean outputs are refused up
  front", or a boolean extraction added in a follow-up.
- **The run-log contract version.** `modelResponse` is added without a `SCHEMA_VERSION` bump. The CHANGELOG
  leaves open whether run-log contracts get their own version.
- **Expiry is not persisted.** The intervention contract has no `expired` status, so a persisted request keeps
  its last status.
- **Status.** The spec is already `Done`. The index keeps `Done` rather than regressing to `Planned`.

## Risks / things to watch during execution

- **The lock depends on the init script** (`captureScript.ts`, `HumanActionRecorder.ts`). A frame that loads
  before the reconfigure lands, or while a native dialog is pending (the 100 ms retry), is briefly
  unguarded. `submit` is intentionally not blocked. Keep the handoff functional test as the regression guard.
- **The takeover timeout leaves the lease `HUMAN`** (`InterventionService.ts`, `LiveSession.ts`). The run fails
  `timeout`, and cleanup relies on the session closing. `stage` is inferred from the request status, not
  carried on the error.
- **Timer races** in `InterventionService.ts`. Claim, resolve and timer firing all go through `serialize()`
  with a generation check. Any new transition must do the same.
- **Real timers against the injected clock** (`DiscoveryLoop.ts`). The abort timer is real, but the budget and
  latency use the injected clock, so the hang test takes about 1 s of real time. A client that ignores the
  signal keeps running in the background, and its result is dropped.
- **Slower hard misses** (`WebSurface.ts`). The 5 s resolve bound makes a truly missing target take up to 5 s
  to fail where it used to take about 100 ms. Keep functional test timeouts above it.
- **An extra check per step** (`StepRunner.ts`). The pre-step checkpoint probe adds one read per checkpointed
  step when condition rules exist, and scripted-surface fixtures need matching `checks` entries.
- **A behaviour change on resume** (`handleHardFailure.ts`). A mutating step without a checkpoint and without
  an allowed human action now fails instead of continuing, which could surprise an operator who "fixed it"
  outside the browser.
- **Case-insensitive name masking** (`createRedactor.ts`). Word-boundary, case-insensitive matching of
  name-like values changes behaviour: `Smith` no longer masks `Smithson`. Review the evidence for
  over- or under-masking.
- **The `modelResponse` sink exemption** (`redactRunLogEntry.ts`) is safe only while the schema patterns stay
  closed. Loosening any pattern re-opens a free-text leak.
- **The barrel gap.** `DEFAULT_BLOCK_MESSAGE` is not yet re-exported from `packages/surface/src/index.ts`.
