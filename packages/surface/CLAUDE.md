# @idp/surface — CLAUDE.md

> Workspace: `packages/surface` · Root rules: [../../CLAUDE.md](../../CLAUDE.md)

## Purpose

The perception-and-action seam between the system and a target application. It owns the **`Surface`
port** (`observe` / `act` / `resolve`), the Playwright web adapter behind it, the locator-ladder resolver,
and the human-action recorder. The accessibility tree is the primary perception. Every other package sees
only the port, which is the seam for legacy-web and desktop surfaces (R7.1). It is the only package that
may import Playwright, and the only place a raw browser action (e.g. `page.click`) may appear.
Shell — empty until the `web-surface` spec lands.

## Owns

- The `Surface` port: `observe` (a11y snapshot / screenshot), `act` (one registered action type),
  `resolve` (locator → element).
- The Playwright web adapter implementing the port.
- The locator-ladder resolver (ordered fallback from the most stable to the least stable locator).
- The human-action recorder that maps human input on the live session to registered action types.

## Never

- Never executes an action that did not pass policy: every `act` maps to one registered action type with
  a risk class and an allowlist check.
- Never lets Playwright types leak through the public `Surface` port.
- Never imports `@idp/session`, `@idp/replay-engine`, `@idp/agent` or any app (incl. `apps/mock-bank`).
- Never depends on `@anthropic-ai/sdk`.
- Never sends unredacted data to evidence (snapshots, screenshots, traces go through redaction first).
- Never downloads browsers in tests.

## Allowed dependencies

- `@idp/artifact-schema`, `@idp/policy`, `@idp/evidence`.
- Third-party: `playwright` (only this package may; it arrives with the `web-surface` spec).
- Dev tools (`typescript`, `vitest`, `rimraf`, `@types/node`) are `catalog:` devDependencies;
  versions live in the root `pnpm-workspace.yaml`. `@idp/typescript-config` is a `workspace:*` devDependency.

## Enforcement

The dependency direction is enforced by `pnpm lint`: ESLint `no-restricted-imports` generated from
`tools/repo-checks/layers.json` (source imports) plus `pnpm boundaries` (manifest check, BND001–BND009).
Codes most relevant here:

- BND001 — may depend only on `@idp/artifact-schema`, `@idp/policy`, `@idp/evidence`.
- BND004 — this package **owns** `playwright` / `playwright-core` / `@playwright/test`; no other
  workspace may list them.
- BND005 (`@anthropic-ai/sdk` is owned by `@idp/agent`).

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
pnpm --filter @idp/surface build
pnpm --filter @idp/surface typecheck
pnpm --filter @idp/surface test
```

Lint and format are root-only (`pnpm lint`, `pnpm format:check`); there is no per-package lint script.
