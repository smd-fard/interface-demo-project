# @idp/cli — CLAUDE.md

> Workspace: `apps/cli` · Root rules: [../../CLAUDE.md](../../CLAUDE.md)

## Purpose

The demo-path command-line app: `discover` (LLM drives the live UI and compiles a capability artifact),
`replay` (deterministic execution of an artifact), `catalog` (list available capabilities) and `operator`
(intervention handoff). It wires the lower packages together and owns no domain logic of its own.
The `idp` bin points at `dist/index.js`, which exists only after build (never commit `dist/`); the root
`pnpm idp <command>` script is added by the `cli-demo-path` spec.
Status: Shell — empty until the `cli-demo-path` spec lands.

## Owns

- The `idp` bin entry and command parsing/dispatch (`discover`, `replay`, `catalog`, `operator`).
- Wiring of session, replay engine and agent for the demo path; printing the `RunResult` to the user.

## Never

- Never imports `@idp/operator` (peer app) or `@idp/mock-bank` (black box, reachable only over HTTP).
- Never imports `playwright` or `@anthropic-ai/sdk` directly — go through `@idp/surface` / `@idp/agent`.
- The `replay` command never constructs or calls the agent / an LLM (invariant 1, R3.1).
- Never echoes secrets from `.env`.
- Never logs or prints unredacted data (invariant 3).

## Allowed dependencies

- `@idp/artifact-schema`, `@idp/session`, `@idp/replay-engine`, `@idp/agent`.
- No third-party runtime dependencies yet.
- Dev tools (`typescript`, `vitest`, `rimraf`, `@types/node`, `tsx`) are `catalog:` devDependencies;
  versions live in the root `pnpm-workspace.yaml`. `@idp/typescript-config` is a `workspace:*` devDependency.

## Enforcement

The dependency direction is enforced by `pnpm lint`: ESLint `no-restricted-imports` generated from
`tools/repo-checks/layers.json` (source imports) plus `pnpm boundaries` (manifest check, BND001–BND009).
Codes most relevant here:

- BND001 — top layer; `@idp/operator` is the same rank (a peer), so it is forbidden.
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

`package.json` declares the `idp` bin → `dist/index.js` (exists only after build).

## Commands

```bash
pnpm --filter @idp/cli build
pnpm --filter @idp/cli typecheck
pnpm --filter @idp/cli test
pnpm --filter @idp/cli start    # node dist/index.js (after build)
pnpm --filter @idp/cli dev      # tsx watch src/index.ts
```

Lint and format are root-only (`pnpm lint`, `pnpm format:check`); there is no per-package lint script.
