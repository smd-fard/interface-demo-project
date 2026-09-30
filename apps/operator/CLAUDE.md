# @idp/operator — CLAUDE.md

> Workspace: `apps/operator` · Root rules: [../../CLAUDE.md](../../CLAUDE.md)

## Purpose

The minimal, deliberately mocked operator console for human handoff: list open intervention requests,
take control of the **same** live session through the control lease, and signal resume back to the agent
or replay run. It serves the escalation requirements R6.1–R6.4 (R6.4 names this app explicitly); the full
operator product is a design in REPORT §5, not code here. It owns presentation only — the lease, the
intervention model and the human-action recorder live in lower packages.
Status: implemented (plan step 51): `node:http` console proxying to the session control API.

## Owns

- The operator console UI: the intervention list, the session view, and the take-control / resume controls.
- Wiring those controls to the session control API through `@idp/session` `ControlClient` (claim, approve,
  reject, resume, abort; evidence proxying). It holds no lease or request state of its own.

## Never

- Never imports `@idp/cli` (peer app), `@idp/replay-engine`, `@idp/agent` or `@idp/mock-bank`
  (black box, reachable only over HTTP).
- Never imports `playwright` or `@anthropic-ai/sdk` — perception and action go through `@idp/session`.
- Never displays unredacted data from intervention requests (invariant 3).
- Takes control only through the session control lease (`AGENT` / `PAUSED` / `HUMAN` / `RESUMING`);
  never bypasses it or drives the page directly.
- Never records or performs human actions itself: the human acts in the live browser, and the session records
  those actions through the surface recorder under policy (invariant 2).
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

## Rules

- The console holds no session state and never the token in anything it serves: it calls the control API
  through `ControlClient` (which holds the token) and renders what comes back, already redacted.
- Every interpolated value goes through `escapeHtml`. No inline handlers; the one inline script and style
  carry the per-response CSP nonce.
- Every route but `GET /login` needs the session cookie issued by `/login?k=<IDP_OPERATOR_KEY>` (one-time key,
  constant-time compare; HttpOnly, SameSite=Strict). The console key is never the control token.
- Every POST is CSRF-checked (form token + Origin / Sec-Fetch-Site); every request is Host-checked.
- Buttons appear only for actions the request offers and the lease allows.

## Layout

```
src/
  main.ts                 process entry: env → ControlClient → OperatorServer; exit 64 on bad config
  config.ts               loadOperatorConfig (IDP_CONTROL_URL, IDP_CONTROL_TOKEN, IDP_OPERATOR_KEY, IDP_OPERATOR_PORT)
  server.ts               OperatorServer: login + session cookie, routes, proxying, CSRF / Host checks, CSP
  OperatorControl.ts      the ControlClient operations the console uses
  stateVersion.ts         fingerprint of lease + requests (the polling script reloads on change)
  http/                   readForm, safeReturnPath, securityHeaders
  views/                  layout, leaseBadge, interventionList, interventionDetail, actionForm,
                          errorPage, escapeHtml, subjectText (+ views.test.ts)
  errors/                 OperatorConfigError, OperatorHttpError, OperatorServerStartError
  *.test-helper.ts        fixtures and a fake control API behind fetch (not built)
test/functional/          console.test.ts: a real ControlServer on a fake session + the real console
```

## Exemplars (copy these)

- A route: `src/server.ts` (`listPage` + a `routes` entry); a view: `src/views/interventionList.ts`.
- Headers and CSP: `src/http/securityHeaders.ts`. Tests: `src/server.test.ts` (fake control API via
  `fakeControlFetch.test-helper.ts`), `test/functional/console.test.ts`.

## Commands

```bash
pnpm --filter @idp/operator build
pnpm --filter @idp/operator typecheck
pnpm --filter @idp/operator test
pnpm --filter @idp/operator test:functional  # real ControlServer + console; spawns dist/main.js
pnpm --filter @idp/operator start    # node dist/main.js (after build; needs IDP_CONTROL_URL/TOKEN)
pnpm --filter @idp/operator dev      # tsx watch src/main.ts
```

Lint and format are root-only (`pnpm lint`, `pnpm format:check`); there is no per-package lint script.
