# @idp/session — CLAUDE.md

> Workspace: `packages/session` · Root rules: [../../CLAUDE.md](../../CLAUDE.md)

## Purpose

The live session controller behind escalation and human handoff (R6.1–R6.3). It owns the **control
lease** — an explicit state machine (`AGENT` / `PAUSED` / `HUMAN` / `RESUMING`) that says who is, or
should be, in control of a live session — plus intervention requests and the pause / cede / resume
protocol. A human takes over the *same* live session (not a fresh one) through the `Surface` port, their
actions are recorded as registered action types, and the agent or replay resumes with context and
evidence preserved. Plan steps 29–31 are in place: `ControlLease`, `LeasedSurface`, `InterventionService`,
the localhost control API (`ControlServer` / `ControlClient`) and `openLiveSession`.

## Rules (steps 29–31)

- The lease (`AGENT` / `PAUSED` / `HUMAN` / `RESUMING` / `CLOSED`) changes only through its methods, serialized
  in a promise queue; a duplicate of the last transition is idempotent, anything else illegal throws
  `IllegalLeaseTransitionError`. Every transition is logged as `lease_change` by the live session.
- The session hands out only `LeasedSurface(PolicyGuardedSurface(web))`. The recorder's guard wraps a
  `LeasedSurface` too, so a human acts only while `HUMAN` and the automation only while `AGENT` (FR20).
- Intervention requests are built from redacted text (`redactInterventionRequest`), validated against
  `InterventionRequestSchema` and persisted as `interventions/<id>[-vN].json` (never overwritten). Grants
  stay in memory.
- The control server binds 127.0.0.1 only, needs the per-session bearer token (system randomness), accepts
  only `{ "operator": "<handle>" }` bodies, and serves only masked screenshots, redacted snapshots and
  intervention documents (never `localOnly` refs or prompts). No zod here: bodies are validated by hand plus
  the artifact-schema contracts.
- `requestApproval` reacquires the lease itself on approve (nothing changed on screen); after `escalate`
  resumes, the caller re-verifies its checkpoint and then calls `lease.reacquire()`.

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
  index.ts           barrel
  lease/             ControlLease (state machine), LeasedSurface (FR20 check on act)
  intervention/      InterventionService, redactInterventionRequest
  control/           ControlServer (node:http, 127.0.0.1), ControlClient (fetch), ControlTarget, LeaseView
  LiveSession.ts     openLiveSession: browser → guard → lease, run dir/log/evidence/manifest, recorder, control API
  errors/            typed errors with stable codes
test/functional/     handoff.test.ts: mock-bank + real headless browser (takeover, approval, unattended)
tsconfig.build.json  emits src → dist (excludes *.test.ts and *.test-helper.ts)
vitest.config.ts     unit: src/**/*.test.ts (the control server binds 127.0.0.1:0; no browser)
vitest.functional.config.ts  test/functional/**; build mock-bank first
```

## Exemplars (copy these)

- A state machine with a serialized queue and typed refusals: `src/lease/ControlLease.ts` (+ `.test.ts`).
- A `Surface` decorator: `src/lease/LeasedSurface.ts`.
- Redact → validate → persist a versioned document: `src/intervention/InterventionService.ts`.
- A route + its status mapping and a typed client: `src/control/ControlServer.ts`, `src/control/ControlClient.ts`
  (unit-tested against `fakeControlTarget.test-helper.ts`).
- A typed error with a stable `code`: `src/errors/InterventionConflictError.ts`.

The public API (every export, the transitions table, the routes and status codes) is in [README.md](README.md).

## Commands

```bash
pnpm --filter @idp/session build
pnpm --filter @idp/session typecheck
pnpm --filter @idp/session test
pnpm --filter @idp/session test:functional   # needs apps/mock-bank/dist
```

Lint and format are root-only (`pnpm lint`, `pnpm format:check`); there is no per-package lint script.
