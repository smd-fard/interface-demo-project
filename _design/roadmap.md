# Roadmap — proposed spec sequence

This is a proposal, not a commitment. Each row becomes one `/define-spec` run, and its slug is the suggested
`feature_slug`. The order follows the dependency direction in `CLAUDE.md`, with one deliberate twist:
**replay comes before discovery**. A hand-written artifact can be replayed against `mock-bank`, so the
artifact contract and the error taxonomy (the load-bearing, most-graded pieces) are proven without an LLM.
Discovery then only has to *emit* something the replay engine already runs.

| #   | Slug                      | Delivers                                                                                                                                                              | Requirements                    |
| --- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 01  | `monorepo-foundation`     | pnpm + Turborepo, `typescript-config`, lint/format, Vitest, empty package shells (via `scaffold-package`), ADR-0001 (stack + layout).                                 | D1 (setup), code quality        |
| 02  | `artifact-schema`         | Capability artifact v1 + locator ladder + params/outputs + checkpoints + outcome rules + **RunResult** union, JSON Schema export, fixtures, ADRs.                     | R2.1–R2.7, R3.4, R3.5, R7.1–R7.2 (room for) |
| 03  | `mock-bank-target`        | A hostile legacy target: login → member search → member detail → open sub-account → confirmation; frames/tables/no test IDs; fault switches; a tenant-B variant.       | enables R3.3, R6, S5            |
| 04  | `web-surface`             | The `Surface` port, the Playwright adapter, accessibility-tree observation, the locator-ladder resolver, waits.                                                       | R1.3, R3.2, R7.1                |
| 05  | `policy-and-redaction`    | Allowlist config, action risk classes, conservative handling of risky actions, redaction rules + the sink wrapper.                                                    | R4.1–R4.3                       |
| 06  | `run-evidence`            | Redacting JSONL run log, screenshots / a11y snapshots / traces on failure, run manifest.                                                                             | R5.1, R5.2                      |
| 07  | `deterministic-replay`    | Replay executor + checkpoint verification + outputs + the **runtime-condition catalog** (not found, validation, permission, dialog, timeout, slow load, app error).     | R3.1–R3.5                       |
| 08  | `discovery-agent`         | Claude tool-calling loop over `Surface`, stop conditions, the artifact compiler (run → parameterized artifact), a real run.                                           | R1.1–R1.3, R2.1, R-REAL         |
| 09  | `session-handoff`         | Control lease, intervention requests, pause/cede/resume on the same session, human-action recorder, the mocked operator console.                                     | R6.1–R6.4                       |
| 10  | `cli-demo-path`           | `idp discover / replay / catalog / operator`, the README demo path, how to run without an API key.                                                                    | D1, R1.1                        |
| 11  | `evidence-and-report`     | `/capture-evidence` runs (discovery, replay OK, replay not-found, replay injected failure, handoff), `REPORT.md` final.                                               | D2, D3, R-REAL                  |
| 12  | *(stretch)* `capability-catalog` or `tenant-variant-overrides` | Pick at most one or two: S1 (agent-facing catalog) and/or S5 (base artifact + per-tenant overrides on mock-bank tenant B).                     | S1 / S5                         |

Cut line if time runs short: finish 01–11 thin-but-real before touching 12. "Cut depth, not whole capabilities."
