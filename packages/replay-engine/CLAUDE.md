# @idp/replay-engine — CLAUDE.md

> Workspace: `packages/replay-engine` · Root rules: [../../CLAUDE.md](../../CLAUDE.md)

## Purpose

The deterministic executor for capability artifacts (R3, R3.1; invariants 1, 4, 5). It runs an
artifact's steps through the `Surface` port with **no LLM in the decision loop**: it waits, verifies a
checkpoint after every screen-changing step, detects runtime conditions, applies bounded recovery, and
classifies the run as `success | business_outcome | failure`. When it is stuck it escalates through
`@idp/session` rather than guessing. Plan steps 32–44 are in place: the engine, the step handlers, the approval
gate and attended escalation (34), and the full condition catalog — business outcomes (35–37), bounded
recoveries (38–41) and hard failures (42–44).

## Owns

- The step executor: waits, locator resolution via the `Surface` port, and per-step checkpoints.
- Runtime-condition detection (e.g. unexpected dialog, session timeout, slow load, app error).
- Bounded recovery for recoverable conditions, logged as evidence inside the run.
- Result classification into the `success | business_outcome | failure` result contract.

## Never

- Never depends on `@idp/agent` or `@anthropic-ai/sdk`, directly or transitively (R3.1; enforced by
  boundary check BND006 and lint). `agent` is a peer, not a dependency.
- Never puts an LLM in the decision loop. Any assisted fallback (stretch S4) is an explicit,
  policy-checked, single-step seam, recorded as evidence.
- Never imports `playwright` directly — only via the `Surface` port.
- Never treats "the click didn't throw" as success: every screen-changing step is followed by a checkpoint.
- Never returns a recoverable condition as an outcome, and never returns a business outcome as a failure.

## Allowed dependencies

- `@idp/artifact-schema`, `@idp/policy`, `@idp/evidence`, `@idp/surface`, `@idp/session`.
- Third-party runtime: none yet.
- Dev tools (`typescript`, `vitest`, `rimraf`, `@types/node`) are `catalog:` devDependencies;
  versions live in the root `pnpm-workspace.yaml`. `@idp/typescript-config` is a `workspace:*` devDependency.

## Enforcement

The dependency direction is enforced by `pnpm lint`: ESLint `no-restricted-imports` generated from
`tools/repo-checks/layers.json` (source imports) plus `pnpm boundaries` (manifest check, BND001–BND009).
Codes most relevant here:

- BND001 — may depend only on layers to its left; `@idp/agent` is the same rank (a peer), so it is
  forbidden.
- BND006 — forbidden reach: the transitive `@idp/*` closure must contain neither `@idp/agent` nor any
  workspace declaring `@anthropic-ai/sdk` (R3.1, invariant 1).
- BND004 (`playwright` is owned by `@idp/surface`); BND005 (`@anthropic-ai/sdk` is owned by `@idp/agent`).

## Layout

```
src/
  index.ts                 barrel
  ReplayEngine.ts          replay(): artifact + hash check → params (before any surface call) → steps →
                           success condition → outputs → result.json + manifest
  ReplayOptions.ts         defaults and bounds (timeouts, retry, dialog/re-auth budgets)
  ReplaySession.ts         the narrow view of LiveSession replay needs (fakeable in unit tests)
  params/                  CredentialProvider port, InMemoryCredentialProvider, bindValues (seeds the redactor)
  checkpoints/             CheckpointVerifier (bounded check raced against a ConditionDetector), describeCheckpoint
  outputs/                 extractOutputs / parseExtracted (text | decimal | integer, then outputsSchemaFor)
  result/                  ResultBuilder (masked evidence on failure), redactResultForSink (free text only)
  steps/                   StepRunner (per-step conditions, approval, escalation), performAction, verifyCheckpoint,
                           handlers/<kind>.ts
  conditions/              CONDITION_CATALOG (every taxonomy code: class, detector, response, budget), resolveRules
                           (artifact rule → profile → catalog), knownDialogRules, detectConditions (pure signature
                           matcher), ConditionWatch (per-step detector; unknown_dialog), classifyCondition,
                           respondToCondition (outcome | recovery plan | thrown failure), failureReasonFor
  recovery/                StepRecovery (per-step budgets), dismissKnownDialog, waitForSlowLoad, performRecoveryAction,
                           recoveryFailure, logRecovery
  escalation/              handleApproval (approval gate), handleHardFailure (takeover, re-verify, reacquire)
  errors/                  ReplayError (code = FailureReason), toReplayError (surface/session errors → reason)
test/functional/           real mock-bank + openLiveSession (`pnpm --filter @idp/replay-engine test:functional`)
```

## Extension points

- **Runtime conditions (`define-runtime-condition`, touch points 2–3):** register the code in `CONDITION_CODES` /
  `CONDITION_CATALOG` (`src/conditions/ConditionCatalog.ts`: default class, detector, response, budget). A
  signature detector is data (an `OutcomeRule` signature in the artifact or `config/apps/*.profile.json`, matched by
  `detectConditions`). An engine detector goes in `ConditionWatch` / `StepRunner.settle`. Class resolution is always
  artifact rule → profile → catalog; an unknown code fails loudly. Map a new failure code in `failureReasonFor`.
  Add the injected-fault test in `test/functional/conditions/<code>.test.ts`.
- **Step handlers (`define-action`, touch point 4):** `src/steps/handlers/<kind>.ts`, dispatched by `dispatch` in
  `src/steps/StepRunner.ts` (the switch is exhaustive over the Step union). Always `performAction(actionBase(...))`
  then `verifyCheckpoint`.

The full taxonomy table (class / response / budget per code), the escalation rules and the result redaction are in
[README.md](README.md). Budgets come from `ReplayOptions`, and every attempt is logged as `recovery`.

## Exemplars (copy these)

- A handler: `src/steps/handlers/click.ts`. A bounded recovery: `src/recovery/waitForSlowLoad.ts`.
- An escalation: `src/escalation/handleHardFailure.ts` (+ `.test.ts` with a fake `EscalationSession`).
- An injected-fault functional test: `test/functional/conditions/failedLoad.test.ts` (with `replayHarness.ts`).

## Known limits

- `unknown_dialog`: Chromium cannot screenshot behind a native dialog, so the failure carries only the redacted
  blocked-page a11y snapshot (`ResultBuilder`). A screenshot ref is never faked.
- `slow_load` is a heuristic: it applies only to a navigate/click/press that used its whole bound and whose
  checkpoint does not hold yet.
- In-place recoveries (dismiss, wait) are not nested inside a retry or re-auth re-run (→ `recovery_exhausted`).
- Escalation: `requestApproval` reacquires the lease itself. After `escalate` resumes, the engine re-verifies the
  checkpoint and then calls `lease.reacquire()`. Unattended runs fail with the persisted `interventionRequestId`.

## Commands

```bash
pnpm --filter @idp/replay-engine build
pnpm --filter @idp/replay-engine typecheck
pnpm --filter @idp/replay-engine test
pnpm --filter @idp/replay-engine test:functional   # needs apps/mock-bank/dist
```

Lint and format are root-only (`pnpm lint`, `pnpm format:check`); there is no per-package lint script.
