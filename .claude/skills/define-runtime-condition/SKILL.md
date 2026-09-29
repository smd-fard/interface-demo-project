---
name: define-runtime-condition
description: Add a runtime condition end-to-end — a fault switch in apps/mock-bank that reproduces it, a detector in the replay engine, its classification (business_outcome | recoverable | hard failure), the deliberate response (return outcome / bounded recovery / fail with evidence / escalate), and an injected-fault functional test asserting the exact RunResult. Use for "record not found", "validation error", "permission denied", "unexpected dialog", "session timeout", "slow load", "app error", or any new exceptional state. Args expected -- "<condition_code> <class: business_outcome|recoverable|failure> <short description>", e.g. "member_not_found business_outcome search returns no member".
---

# define-runtime-condition

The brief is explicit: the interesting failures are **runtime conditions, not layout drift** (R3.3), and the
result must separate **business outcomes**, **recoverable conditions** and **hard failures** (R3.4). This skill
adds one condition across the whole stack, so each one is reproducible, detected, classified and proven.

> The condition catalog location is defined in `@idp/replay-engine`'s `CLAUDE.md`. Read an existing condition
> end to end before adding one.

## Classification rules (decide before coding)

| Class              | Meaning                                                                 | Replay response                                                                                             | Returned as                                                              |
| ------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `business_outcome` | A legitimate answer the caller needs ("no such member", "insufficient funds"). | Stop cleanly. No retry.                                                                                     | `RunResult{ kind: 'business_outcome', code, details }`                   |
| `recoverable`      | A transient or known interstitial (slow load, a known dialog, an expired session with re-auth allowed). | A **bounded** recovery (N retries with backoff / dismiss / re-auth). Log every attempt. If the budget is exhausted, escalate the class. | Nothing extra on success (recorded in the run log); otherwise `failure`  |
| `failure`          | Unknown state, permission denial, app error, or a checkpoint mismatch.  | Stop. Capture a screenshot, a11y snapshot and trace. Raise an intervention request if the policy says so.  | `RunResult{ kind: 'failure', step, expected, observed, evidence[] }`     |

A condition's class may depend on the artifact. "Not found" is a business outcome for a lookup capability and
may be a failure for another. Put the **default** in the catalog and allow the artifact's outcome rules to
declare it explicitly. Never guess at runtime.

## The four touch points

1. **`apps/mock-bank`**: a fault switch that reproduces the condition deterministically (e.g. `?fault=<code>`,
   a header, or a per-session admin toggle, whichever the mock-bank CLAUDE.md defines). Legacy-realistic
   rendering: an error inside a nested table, an alert frame, a server-rendered message with no semantic
   role. **Via `define-mock-screen`** if it needs a new page.
2. **Detector** (`@idp/replay-engine`): how the condition is recognized from a `Surface` observation
   (accessibility-tree role/name/text, landing route, HTTP status, dialog event, timing). Prefer signals a
   non-DOM surface would also have (visible text, window title), and say which signal you chose and why.
3. **Classification + response** in the condition catalog (code, default class, recovery budget,
   escalation behaviour), plus schema support if the artifact can declare it (via `define-schema`).
4. **Functional test** in `packages/replay-engine/test/functional/`: start mock-bank with the fault on, replay
   the reference artifact, and assert the **exact** `RunResult` variant and code. For recoverables, assert both
   paths: recovered (success + the recovery attempts in the log) and budget-exhausted (failure).

## Steps

1. Decide the class with the table above. If the spec doesn't settle it, ask the user.
2. **Test first** (red), for the four touch points.
3. Implement mock-bank fault → detector → catalog entry.
4. `pnpm build && pnpm test`.
5. Suggest an evidence scenario: `/capture-evidence replay-fault <code>`.
6. Report:
   ```
   Condition: <code> → <class>  (detector signal: <signal>)
   Mock-bank: <fault switch>
   Response:  <return outcome | recover ×N then fail | fail + intervention>
   Tests:     <files> (<n> scenarios)
   Evidence:  /capture-evidence replay-fault <code>
   ```
