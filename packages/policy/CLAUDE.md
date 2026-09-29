# @idp/policy — CLAUDE.md

> Workspace: `packages/policy` · Root rules: [../../CLAUDE.md](../../CLAUDE.md)

## Purpose

The guardrail rules of the system as pure functions: the allowlist (domains, routes, action types), the
risk class of every action type, and the redaction rules applied before data reaches any sink. It is the
single source of truth behind hard invariant 2 (every action goes through policy) and invariant 3 (redact
before any sink), and serves the guardrail requirements in `docs/requirements.md`.
Shell — empty until its spec lands.

## Owns

- The allowlist: permitted domains, routes and action types.
- Action risk classes (e.g. `read` / `reversible` / `irreversible`) and the policy check per action.
- Redaction rules (what counts as sensitive and how it is masked) — as data and pure functions.

## Never

- Never performs I/O (no filesystem, network, env or clock access) — pure functions only.
- Never imports `@idp/evidence`, `@idp/surface`, `@idp/session`, `@idp/replay-engine`, `@idp/agent` or
  any app.
- Never depends on `playwright` or `@anthropic-ai/sdk`.
- Never lets an action type exist without a policy entry (risk class + allowlist key).

## Allowed dependencies

- `@idp/artifact-schema` only. No third-party runtime dependencies yet.
- Dev tools (`typescript`, `vitest`, `rimraf`, `@types/node`) are `catalog:` devDependencies;
  versions live in the root `pnpm-workspace.yaml`. `@idp/typescript-config` is a `workspace:*` devDependency.

## Enforcement

The dependency direction is enforced by `pnpm lint`: ESLint `no-restricted-imports` generated from
`tools/repo-checks/layers.json` (source imports) plus `pnpm boundaries` (manifest check, BND001–BND009).
Codes most relevant here:

- BND001 — may depend only on `@idp/artifact-schema` (layers to its left).
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
pnpm --filter @idp/policy build
pnpm --filter @idp/policy typecheck
pnpm --filter @idp/policy test
```

Lint and format are root-only (`pnpm lint`, `pnpm format:check`); there is no per-package lint script.
