---
name: write-functional-test
description: Add an end-to-end Vitest functional test that starts apps/mock-bank as a real process and drives it through the real Playwright Surface — replaying an artifact, running the agent loop with a scripted fake model, or exercising a session handoff — and asserts the RunResult contract and evidence. Use when the user asks to "add a functional/e2e test", "test replay of <capability>", "test the <condition> path", or a feature exists without end-to-end coverage. Args expected -- "<package> <scenario>", e.g. "replay-engine member-lookup not-found".
---

# write-functional-test

Adds one file: `<pkg>/test/functional/<area>/<Scenario>.test.ts`. Functional tests are the proof for R3.2
(stable targeting + checkpoints against a real UI), R3.3 (runtime conditions) and R6.* (a handoff on the same
live session). They do **not** replace `/capture-evidence`, because tests never call a real LLM.

> Once the first functional test lands, its harness (mock-bank launcher, browser fixture, artifact fixtures) is
> the exemplar. Reuse it. Don't write a second launcher.

## Hard rules

- **mock-bank runs as a separate process** on a free port, started in `beforeAll` and killed in `afterAll`
  through the shared launcher. Never import mock-bank code.
- **Real Playwright, headless**, through `@idp/surface`. Tests do not call Playwright directly, except via the
  surface's test fixture.
- **No real LLM.** Agent scenarios use `ScriptedModel`, so the test proves the loop, the tools, the policy and
  the compiler deterministically.
- **Assert the contract, then the evidence.** First `RunResultSchema.parse(result)` and the exact
  `kind`/`code`/outputs. Then, on failure variants, that the evidence refs exist (screenshot, a11y snapshot)
  and that the run log contains no raw param values.
- **Fault injection is explicit:** use the mock-bank fault switch documented in its README, never timing luck.
- One scenario family per file. Name the cases after the behaviour (`returns member_not_found business outcome`).
- Keep them fast: reuse one browser per file with a fresh context per test, and keep timeouts explicit.

## Steps

1. Read the feature's spec ACs and the code under test. List the scenarios: happy path, each relevant runtime
   condition, a policy denial, and (for session) the lease transitions.
2. Reuse the functional harness. If none exists yet (the first functional test in the repo), create it in the
   package's `test/functional/harness/`: a mock-bank launcher (spawn `pnpm --filter @idp/mock-bank start` or
   the built entry with `PORT`, then wait on a health URL), a browser/context fixture, and an artifact fixture
   loader. Report it as new.
3. Write the test. Run `pnpm --filter <pkg> build && pnpm --filter <pkg> test -- <Scenario>`.
4. If behaviour surprises you, **flag it**. Don't rewrite the source or the test to hide it.
5. Report:
   ```
   Test:      <path>
   Scenarios: <n> — <list with expected RunResult variant>
   Harness:   <reused | created: files>
   Surprise:  <none | behaviour that didn't match the spec>
   ```
