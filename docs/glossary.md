# Glossary

Terms from the brief, plus the names this codebase uses for them. Use these names consistently in code, specs
and docs.

| Term                    | Meaning here                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Capability / artifact   | The typed, versioned, reviewable JSON description of a flow that an AI agent can invoke: steps, targets, params, outputs, checkpoints, outcome rules. |
| Discovery run           | An LLM-driven observe → decide → act run that tries to satisfy a goal and, on success, is compiled into an artifact.                 |
| Replay                  | Deterministic execution of an artifact with params. No LLM in the decision loop.                                                      |
| Surface                 | The port for perceiving and acting on an app (web via Playwright today; legacy web or desktop via UIA/AX in the design).              |
| Observation             | What a surface returns from `observe()`: an accessibility-tree snapshot (+ optional screenshot), redacted before it reaches the LLM or logs. |
| Locator ladder          | An ordered list of ways to find one target (role+name → label/text → scoped structural → visual anchor). Replay records which rung matched. |
| Checkpoint              | A verifiable assertion that the expected state was reached after a step (or at the end = success condition).                           |
| Runtime condition       | An exceptional state at replay time: not found, validation error, permission denied, unexpected dialog, session timeout, slow/failed load, app error. |
| Business outcome        | A legitimate result the caller needs (e.g. `member_not_found`). Not a failure.                                                        |
| Recoverable condition   | A condition handled inside the run with a bounded response (retry, dismiss, re-auth). It is logged, not returned.                      |
| Hard failure            | Stop with a debuggable result: step, expected, observed, evidence refs.                                                               |
| RunResult               | The replay result union: `success` · `business_outcome` · `failure`.                                                                  |
| Action type             | A registered kind of step (click, fill, select, extract, …) with a risk class and policy entry.                                       |
| Risk class              | `read` · `reversible` · `irreversible`. Irreversible actions are handled conservatively (see the policy ADR).                         |
| Allowlist               | The configured permitted domains/routes and action types. Anything outside it is refused.                                             |
| Intervention request    | A request for a human with context: capability/goal, current step, redacted state/screenshot, and why the run stopped.                |
| Control lease           | Who controls the live session: `AGENT` · `PAUSED` · `HUMAN` · `RESUMING`. One holder at a time.                                       |
| Handoff                 | Pausing automation, giving a human the same live session, recording their actions, then resuming.                                    |
| Tenant / variant        | One institution running a vendor app, possibly relabelled or re-versioned. mock-bank tenant B is the stand-in.                        |
| Evidence                | Curated, redacted run output in `/evidence`: artifact, run logs, results, screenshots/snapshots/traces.                               |
