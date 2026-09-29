# @idp/replay-engine — CLAUDE.md

> Workspace: `packages/replay-engine` · Root rules: [../../CLAUDE.md](../../CLAUDE.md)

## Purpose

The deterministic executor for capability artifacts (R3, R3.1; invariants 1, 4, 5). It runs an
artifact's steps through the `Surface` port with **no LLM in the decision loop**: it waits, verifies a
checkpoint after every screen-changing step, detects runtime conditions, applies bounded recovery, and
classifies the run as `success | business_outcome | failure`. When it is stuck it escalates through
`@idp/session` rather than guessing. Shell — empty until its spec lands.

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
  index.ts           barrel — currently `export {};`
  index.test.ts      placeholder test (keeps the test gate green until real tests land)
tsconfig.json        noEmit; typecheck + editor, includes src, test/ and vitest.config.ts
tsconfig.build.json  emits src → dist (excludes *.test.ts)
vitest.config.ts     src/**/*.test.ts + test/**/*.test.ts, node env, no file parallelism
```

## Commands

```bash
pnpm --filter @idp/replay-engine build
pnpm --filter @idp/replay-engine typecheck
pnpm --filter @idp/replay-engine test
```

Lint and format are root-only (`pnpm lint`, `pnpm format:check`); there is no per-package lint script.
