# @idp/agent — CLAUDE.md

> Workspace: `packages/agent` · Root rules: [../../CLAUDE.md](../../CLAUDE.md)

## Purpose

The discovery side of the system (R1, R2). It owns the LLM discovery loop — observe → decide → act,
with model tools wired to the `Surface` port — that drives a live UI until a natural-language goal is
met, and the **artifact compiler** that turns a successful run into a typed, versioned capability
artifact, separate from the model transcript. It is the only package that may import the Anthropic
SDK. Shell — empty until its spec lands.

## Owns

- The LLM discovery loop: model tool definitions ⇄ `Surface` (`observe` / `act` / `resolve`).
- The artifact compiler: successful run → capability artifact (steps, locators, typed params/outputs,
  checkpoints, outcome rules), validated against `@idp/artifact-schema`.
- The model-client port and the scripted fake model used by tests.

## Never

- Never imports `@idp/replay-engine` (it is a peer) or any app (incl. `apps/mock-bank`).
- Never depends on `playwright` directly (only via the `Surface` port).
- Never issues an agent tool call that does not map to a registered action type and pass policy.
- Never sends unredacted data to an LLM prompt (it passes through the redaction layer first).
- Never compiles concrete values into an artifact — only parameter references (`{{memberId}}`).
- Never calls a real LLM from tests — use a scripted fake model.

## Allowed dependencies

- `@idp/artifact-schema`, `@idp/policy`, `@idp/evidence`, `@idp/surface`, `@idp/session`.
- Third-party runtime: `@anthropic-ai/sdk` (only this package may; added by its spec).
- Dev tools (`typescript`, `vitest`, `rimraf`, `@types/node`) are `catalog:` devDependencies;
  versions live in the root `pnpm-workspace.yaml`. `@idp/typescript-config` is a `workspace:*` devDependency.

## Enforcement

The dependency direction is enforced by `pnpm lint`: ESLint `no-restricted-imports` generated from
`tools/repo-checks/layers.json` (source imports) plus `pnpm boundaries` (manifest check, BND001–BND009).
Codes most relevant here:

- BND001 — may depend only on layers to its left; `@idp/replay-engine` is the same rank (a peer), so it
  is forbidden.
- BND005 — this package **owns** `@anthropic-ai/sdk`; no other workspace may list it.
- BND004 (`playwright` is owned by `@idp/surface`).

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
pnpm --filter @idp/agent build
pnpm --filter @idp/agent typecheck
pnpm --filter @idp/agent test
```

Lint and format are root-only (`pnpm lint`, `pnpm format:check`); there is no per-package lint script.
