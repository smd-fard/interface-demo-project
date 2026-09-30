# @idp/mock-bank — CLAUDE.md

> Workspace: `apps/mock-bank` · Root rules: [../../CLAUDE.md](../../CLAUDE.md)

## Purpose

The **proxy target**: a deliberately hostile legacy core-banking web app (framesets, nested tables,
no test IDs, non-semantic markup) that discovery, replay and handoff run against. It exposes
fault-injection switches (not found, validation error, dialogs, timeouts, slow loads, app errors) and a
tenant variant so determinism, error handling and multi-tenant drift can be demonstrated
(R1.3, R3.2, R7.2, D3). The system treats it as a black box, reachable only over HTTP through a
`Surface`; tests start it as a separate process. Synthetic data only.
Status: Implemented (plan steps 18–22 of `computer-use-automation-system`). Screens, faults and tenants are
documented in [README.md](README.md).

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
  main.ts              process entry: env → server, prints `listening <url>`, SIGTERM/SIGINT
  server.ts            createMockBankServer(config): node:http, session check, request-level faults
  router.ts            the route table (method + exact path) and findRoute
  AppContext.ts        config, tenant and in-memory state (sessions, faults, ledger) + reset
  config.ts            loadConfig(env) and defaults
  routes/              route modules (health, admin, frames, signOn, member, subAccount) + Route types
  screens/             pure HTML renderers, one per screen (+ messages, errors, shell)
  html/legacy.ts       hostile-markup helpers (nested layout tables, adjacent-cell labels, no ids/ARIA)
  http/                request.ts (body, form, JSON and cookie readers) + respond.ts (html/text/json/redirect)
  session/             SessionStore (cookie session, idle timeout, injectable clock)
  faults/              fault codes + default routes, spec parsing, FaultSwitch, route matching
  tenants/tenants.ts   per-tenant config (tenant B = relabelled, reordered, other version)
  data/                synthetic members, users, SubAccountLedger (SA-nnnnnn sequence)
  errors/              typed errors with stable codes
test/functional/       spawn dist/main.js on port 0 and assert over HTTP (harness/ has the helpers)
vitest.config.ts             unit tests: src/**/*.test.ts (no processes, no network)
vitest.functional.config.ts  functional tests: test/functional/**/*.test.ts (needs `build` first)
```

## Exemplars

- A screen: `src/screens/memberSearch.ts` (pure renderer over `html/legacy.ts`, tenant-driven labels).
- A route module: `src/routes/member.ts` (content routes, screen-level faults via `app.faults.take`).
- A fault: its entry in `src/faults/faultCodes.ts` + the case in `test/functional/faults.test.ts`.

## Rules for changes

- Visible texts, titles, control names, frame names and routes are a public contract with the fixtures in
  `packages/artifact-schema/fixtures/` (see `fixtures/README.md` "Mock-bank screen contract"). Change them only
  together.
- Faults are never random. A new fault gets a code in `faults/faultCodes.ts` with a documented default
  route, a functional test in `faults.test.ts` and a row in the README fault table.
- Tenant differences live only in `tenants/tenants.ts`; screens read the tenant, they are never copied.

## Commands

```bash
pnpm --filter @idp/mock-bank build
pnpm --filter @idp/mock-bank typecheck
pnpm --filter @idp/mock-bank test
pnpm --filter @idp/mock-bank test:functional   # after build
pnpm --filter @idp/mock-bank start    # node dist/main.js (after build)
pnpm --filter @idp/mock-bank dev      # tsx watch src/main.ts
```

Lint and format are root-only (`pnpm lint`, `pnpm format:check`); there is no per-package lint script.
