# ADR-0004: Result contract and runtime-condition taxonomy

| Field          | Value                                                    |
| -------------- | -------------------------------------------------------- |
| Status         | Accepted                                                 |
| Date           | 2026-09-29                                               |
| Requirements   | R3.3, R3.4, R3.5, R5.2, R6.1, R7.1                       |
| Report section | 3                                                        |
| Spec           | `_design/computer-use-automation-system/spec.md`         |

## Context

Replay runs against legacy apps that fail in many ways: a member is not found, a field is rejected, a dialog
appears, the session times out, a page loads slowly or returns a 5xx, the app shows an error page. The caller is
an AI agent. It must know whether it got an **answer** (the member does not exist), whether the run **broke**
(and where), or whether it should retry. R3.4 asks for three distinct classes: business outcome, recoverable
condition and hard failure. R3.5 asks for a structured result that names the step, what was expected and what
was observed. Replay has no LLM (R3.1), so every condition must be classified by fixed rules, and each response
must be bounded. The detectors must also work on non-DOM surfaces later (R7.1).

## Options

### A. Exceptions plus a boolean `ok`

- ➕ Idiomatic, little code.
- ➖ "Member not found" becomes a thrown error. The caller must parse messages to tell an answer from a bug.
  Recoverables leak out as exceptions, or are swallowed with no trace. Exceptions have no schema and no JSON
  Schema export.

### B. A two-kind `ok | error` result

- ➕ Typed and simple. Most result libraries use it.
- ➖ Business outcomes land in `error`, so an agent retries or alerts on a valid answer. The error needs a sub-tag
  anyway, which rebuilds option C less clearly.

### C. Generic resilience: retry everything

- ➕ Hides flaky loads with no per-condition work.
- ➖ Retrying a permission denial or a not-found wastes time and can repeat side effects. Retrying after an
  irreversible click is unsafe. Nothing tells the caller what happened.

### D. A three-kind union plus a condition catalog with bounded, per-class responses

- ➕ Each class maps to one result kind or to an in-run recovery. The type system keeps them apart.
- ➖ Every new condition needs a catalog entry, a detector signature and a test.

## Decision

**Option D.** Replay returns exactly one `RunResult` (`packages/artifact-schema/src/result/RunResult.ts`), a Zod
discriminated union on `kind`: `success` (outputs, drift, recovery count), `business_outcome` (code, redacted
message, step id) or `failure` (`FailureReason`, step, expected, observed, evidence refs, optional
intervention-request id). `FailureReason` has no member for a recoverable condition or a business outcome, by
construction, and a test asserts this. `replay()` does not throw for run-level problems.

Conditions come from `CONDITION_CATALOG` (`packages/replay-engine/src/conditions/`). The class resolves
**artifact rule → app profile → catalog default**. A code that none of these sources knows fails as
`checkpoint_failed`, so the engine never guesses a class. Signatures match surface-neutral signals: visible frame
text, titles, routes, dialog text and HTTP status (`detectConditions`). Budgets come from `ReplayOptions`, and a
rule may lower them but never raise them:

| Class            | Codes                                                                     | Response (budget)                                                                                                         |
| ---------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| business_outcome | `member_not_found`, `validation_rejected`, `permission_denied`            | stop, return the outcome (0)                                                                                              |
| recoverable      | `known_dialog`, `slow_load`, `failed_load`, `session_timeout`             | dismiss ≤ 1 per step; one wait up to `slowLoadBudgetMs`, then `failed_load`; retry max 2 with 500 ms backoff; one re-auth per run             |
| failure          | `unknown_dialog`, `app_error`, `target_unresolved`, `checkpoint_failed`   | stop, capture masked evidence, escalate when attended (0)                                                                  |

An exhausted budget ends the run as `recovery_exhausted` (or `session_lost`), never as an outcome. Retries never
repeat an irreversible step, and a re-auth is refused once an irreversible step has run. Each recovery is logged.
Hard failures capture a masked screenshot and a redacted a11y snapshot. In attended runs, `handleHardFailure`
raises an intervention request, re-verifies the checkpoint when the operator resumes, and then continues. In
unattended runs, the `failure` carries the request ref. Each code has an injected-fault functional test in
`packages/replay-engine/test/functional/conditions/`.

## Consequences

- **Easier:** callers branch on `kind` with no string parsing. Every failure says where it failed, what was
  expected and what was observed, and where the evidence is. The JSON Schema export documents the contract.
  Per-app differences go in profiles or artifact rules, not in engine code.
- **Harder:** a new condition touches the catalog, a detector signature, `mock-bank` and a test
  (`define-runtime-condition`). Adding a `FailureReason` changes the public contract and bumps its version.
  Known limits: `unknown_dialog` has **no screenshot**, because Chromium cannot capture the page while a native
  dialog is pending, so the failure carries only the a11y snapshot. `slow_load` is a heuristic: only a navigate,
  click or press that used its whole step bound counts as slow, so a slow load that finishes inside the bound is
  not reported. In-place recoveries do not nest inside a retry or re-auth re-run; that case ends as
  `recovery_exhausted`.
- **Revisit when:** a tenant needs a condition the signature kinds cannot express. Another signal is when
  callers ask for partial outputs on failure, or when real runs show retry budgets that are too tight or too loose.
