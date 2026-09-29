# @idp/session — CLAUDE.md

> Workspace: `packages/session` · Root rules: [../../CLAUDE.md](../../CLAUDE.md)

## Purpose

The live session controller behind escalation and human handoff (R6.1–R6.3). It owns the **control
lease** — an explicit state machine (`AGENT` / `PAUSED` / `HUMAN` / `RESUMING`) that says who is, or
should be, in control of a live session — plus intervention requests and the pause / cede / resume
protocol. A human takes over the *same* live session (not a fresh one) through the `Surface` port, their
actions are recorded as registered action types, and the agent or replay resumes with context and
evidence preserved. Shell — empty until its spec lands (`session-handoff`).

## Owns

- The control lease state machine (`AGENT` / `PAUSED` / `HUMAN` / `RESUMING`) and its legal transitions.
- Intervention requests: raising them with context (capability/goal, current step, state, why).
- Pause / cede / resume on the same live session, preserving context and evidence across the handoff.

## Never

- Never imports `@idp/replay-engine`, `@idp/agent` or any app (incl. `apps/mock-bank`).
- Never depends on `playwright` directly (only via the `Surface` port) or on `@anthropic-ai/sdk`.
- Never lets two controllers hold the lease at once.
- Never puts unredacted data in an intervention request (it passes through the redaction layer first).
- Never accepts a human-recorded action that does not map to a registered action type and pass policy.

## Allowed dependencies

- `@idp/artifact-schema`, `@idp/policy`, `@idp/evidence`, `@idp/surface`.
- Third-party runtime: none yet.
- Dev tools (`typescript`, `vitest`, `rimraf`, `@types/node`) are `catalog:` devDependencies;
  versions live in the root `pnpm-workspace.yaml`. `@idp/typescript-config` is a `workspace:*` devDependency.

## Enforcement

The dependency direction is enforced by `pnpm lint`: ESLint `no-restricted-imports` generated from
`tools/repo-checks/layers.json` (source imports) plus `pnpm boundaries` (manifest check, BND001–BND009).
Codes most relevant here:

- BND001 — may depend only on layers to its left (artifact-schema, policy, evidence, surface).
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
pnpm --filter @idp/session build
pnpm --filter @idp/session typecheck
pnpm --filter @idp/session test
```

Lint and format are root-only (`pnpm lint`, `pnpm format:check`); there is no per-package lint script.
