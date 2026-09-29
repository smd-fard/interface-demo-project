# Spec for <feature-slug>

branch: `feature/<feature-slug>`

| Field             | Value                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------- |
| PoC               | <name>                                                                                  |
| Date              | <YYYY-MM-DD>                                                                            |
| Status            | Draft                                                                                   |
| Requirements      | <IDs from docs/requirements.md, e.g. R3.3, R3.4, D3>                                    |
| Affected packages | <**new**/changed workspaces, e.g. **new** `packages/replay-engine`, `apps/mock-bank`>   |
| Contract impact   | <None, or: artifact `schemaVersion` bump (major/minor/patch) and why>                   |
| Safety impact     | <None, or: new action types + risk class, new data sinks, new redaction rules>          |

---

## Summary

<What exists after this change that did not exist before, and why it matters to the through-line
(discover → artifact → deterministic replay). 1–3 short paragraphs. No code.>

## Functional Requirements

- FR1 — <observable behaviour, testable>
- ...

## Non-Functional Requirements

- <determinism, latency/timeouts, redaction, observability, the "no LLM on the replay path" rule, …>

## Decisions

- <Each defendable choice this spec makes + the rejected alternative. Anything worth defending in the
  interview gets an ADR (`/define-adr`); link it here.>

## Possible Edge Cases

- <runtime conditions, malformed inputs, partial state, human-handoff interleavings, …>

## Acceptance Criteria

- AC1 — <Given / When / Then, verifiable by a test or an evidence file>
- ...

## Evidence

- <What lands in `evidence/` or in tests to prove the ACs. Write "n/a" when the ACs are fully covered by tests.>

## Out of Scope

- <Explicit cuts. These feed REPORT §7 "Cuts".>

## Open Questions

- <Anything the PoC must answer before `/define-plan`.>
