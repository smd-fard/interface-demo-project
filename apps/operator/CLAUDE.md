# @idp/operator — CLAUDE.md

> Workspace: `apps/operator` · Root rules: [../../CLAUDE.md](../../CLAUDE.md)

## Purpose

The minimal, deliberately mocked operator console for human handoff: list open intervention requests,
take control of the **same** live session through the control lease, and signal resume back to the agent
or replay run. It serves the escalation requirements R6.1–R6.4 (R6.4 names this app explicitly); the full
operator product is a design in REPORT §5, not code here. It owns presentation only — the lease, the
intervention model and the human-action recorder live in lower packages.
Status: Shell — empty until its spec lands.

## Owns

- The operator console UI: the intervention list, the session view, and the take-control / resume controls.
- Wiring those controls to `@idp/session` (lease transitions, intervention requests).

## Never

- Never imports `@idp/cli` (peer app), `@idp/replay-engine`, `@idp/agent` or `@idp/mock-bank`
  (black box, reachable only over HTTP).
- Never imports `playwright` or `@anthropic-ai/sdk` — perception and action go through `@idp/session`.
- Never displays unredacted data from intervention requests (invariant 3).
- Takes control only through the session control lease (`AGENT` / `PAUSED` / `HUMAN` / `RESUMING`);
  never bypasses it or drives the page directly.
- Human actions are recorded through the surface recorder and pass policy (invariant 2) — never raw.
- Synthetic data only (invariant 7).

## Allowed dependencies

- `@idp/artifact-schema`, `@idp/session`.
- No third-party runtime dependencies yet.
- Dev tools (`typescript`, `vitest`, `rimraf`, `@types/node`, `tsx`) are `catalog:` devDependencies;
  versions live in the root `pnpm-workspace.yaml`. `@idp/typescript-config` is a `workspace:*` devDependency.

## Enforcement

The dependency direction is enforced by `pnpm lint`: ESLint `no-restricted-imports` generated from
`tools/repo-checks/layers.json` (source imports) plus `pnpm boundaries` (manifest check, BND001–BND009).
Codes most relevant here:

- BND001 — top layer; `@idp/cli` is the same rank (a peer), so it is forbidden.
- BND003 — `@idp/mock-bank` is isolated: no workspace may depend on it.
- BND004 (`playwright` is owned by `@idp/surface`); BND005 (`@anthropic-ai/sdk` is owned by `@idp/agent`).

## Layout

```
src/
  index.ts           barrel / app entry — currently `export {};`
  index.test.ts      placeholder test (keeps the test gate green until real tests land)
tsconfig.json        noEmit; typecheck + editor, includes src, test/ and vitest.config.ts
tsconfig.build.json  emits src → dist (excludes *.test.ts)
vitest.config.ts     src/**/*.test.ts + test/**/*.test.ts, node env, no file parallelism
```

## Commands

```bash
pnpm --filter @idp/operator build
pnpm --filter @idp/operator typecheck
pnpm --filter @idp/operator test
pnpm --filter @idp/operator start    # node dist/index.js (after build)
pnpm --filter @idp/operator dev      # tsx watch src/index.ts
```

Lint and format are root-only (`pnpm lint`, `pnpm format:check`); there is no per-package lint script.
