# Spec for review-fixes

branch: `feature/review-fixes`

| Field             | Value                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| PoC               | Mos Fard                                                                                       |
| Date              | 2026-09-30                                                                                     |
| Status            | Done                                                                                           |
| Requirements      | R1.2, R2.5, R3.2, R3.3, R4.1, R4.2, R4.3, R5.1, R6.1–R6.4, R-REAL, D1–D3                        |
| Affected packages | `packages/{policy,surface,session,replay-engine,agent}`, `apps/{cli,operator,mock-bank}`, docs  |
| Contract impact   | None to the artifact schema. Run-log events gain optional model-response metadata.             |
| Safety impact     | Tightens mediation of the headed browser, human input and the operator console.                |

---

## Summary

A pre-submission review of the whole system against the brief found no missing requirement, but a safety
hole in the attended demo path, several bugs, and write-up claims that overstate the code. This change fixes
the code, makes the docs match it, and recaptures the evidence so it reflects the fixed system.

## Functional Requirements

- FR1 — While the lease is not `HUMAN`, the headed browser blocks every user gesture (click, key, submit,
  input, change) instead of letting it through unrecorded.
- FR2 — Human fill/select input is policy-checked before it takes effect; a refused value is reverted.
- FR3 — A takeover wait is bounded by the human session, not by the approval timeout; a claimed request no
  longer times out while the human holds control; a timed-out request is expired.
- FR4 — `idp discover --attended` writes the control files and prints the control URL like `replay`.
- FR5 — The operator console requires the session control token.
- FR6 — Repeated policy denials in discovery escalate like the other stuck triggers.
- FR7 — Boolean outputs compile to a boolean extraction and replay successfully.
- FR8 — Dead-end detection counts distinct screens across actions, not no-op pairs.
- FR9 — A model API failure writes a `failure` result; the discovery timeout bounds each model call.
- FR10 — The run log records per-turn model response metadata (response id, model, stop reason, usage).
- FR11 — Negative checkpoints fail when the page cannot be read; the ladder waits (bounded) for a late
  element; recovery respects policy-raised irreversible risk.
- FR12 — `checkpoint_failed` has an injected-fault functional test.
- FR13 — The redactor leaves hex digests intact; no empty `catch {}` remains.
- FR14 — README, REPORT (≤ ~3 pages, no internal IDs) and evidence match the code; evidence has no machine paths.

## Acceptance Criteria

- `pnpm build typecheck lint format:check test test:functional` pass.
- Each FR above has a unit or functional test (docs FR14 excepted).
- Evidence is recaptured under the fixed code, including a real discovery run with response metadata.

## Decisions

- [ADR-0010](../../docs/adr/0010-locked-window-bounded-takeover-console-key.md) — locked headed window, bounded
  takeover and one-time operator console key (extends ADR-0006; records FR5's stricter implementation).
