# @idp/mock-bank — CLAUDE.md

> Workspace: `apps/mock-bank` · Root rules: [../../CLAUDE.md](../../CLAUDE.md)

## Purpose

The **proxy target**: a deliberately hostile legacy core-banking web app (framesets, nested tables,
no test IDs, non-semantic markup) that discovery, replay and handoff run against. It exposes
fault-injection switches (not found, validation error, dialogs, timeouts, slow loads, app errors) and a
tenant variant so determinism, error handling and multi-tenant drift can be demonstrated
(R1.3, R3.2, R7.2, D3). The system treats it as a black box, reachable only over HTTP through a
`Surface`; tests start it as a separate process. Synthetic data only.
Status: Shell — empty until its spec lands.

## Owns

- The HTTP server and the legacy screens (login, member search, member detail, sub-account flows, errors).
- Fault-injection switches and the tenant-variant overrides.
- The synthetic member/account data set.

## Never

- Never imports any `@idp/*` package, and nothing imports `@idp/mock-bank` (boundary check BND003 + lint).
- Never adds test IDs, ARIA-friendly semantics or other affordances that make it easier than a real
  legacy app — it is deliberately hostile.
- Never uses real PII, real credentials or real bank data — synthetic data only (invariant 7).
- Never calls external networks.

## Allowed dependencies

- No `@idp/*` dependencies at all (only `@idp/typescript-config` as a devDependency for tsconfig).
- No third-party runtime dependencies yet.
- Dev tools (`typescript`, `vitest`, `rimraf`, `@types/node`, `tsx`) are `catalog:` devDependencies;
  versions live in the root `pnpm-workspace.yaml`. `@idp/typescript-config` is a `workspace:*` devDependency.

## Enforcement

The dependency direction is enforced by `pnpm lint`: ESLint `no-restricted-imports` generated from
`tools/repo-checks/layers.json` (source imports) plus `pnpm boundaries` (manifest check, BND001–BND009).
Codes most relevant here:

- BND003 — isolated: it may list only tooling devDependencies (`@idp/typescript-config`), and no workspace
  may depend on it. ESLint forbids imports in both directions.

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
pnpm --filter @idp/mock-bank build
pnpm --filter @idp/mock-bank typecheck
pnpm --filter @idp/mock-bank test
pnpm --filter @idp/mock-bank start    # node dist/index.js (after build)
pnpm --filter @idp/mock-bank dev      # tsx watch src/index.ts
```

Lint and format are root-only (`pnpm lint`, `pnpm format:check`); there is no per-package lint script.
