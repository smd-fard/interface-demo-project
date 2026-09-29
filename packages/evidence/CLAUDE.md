# @idp/evidence — CLAUDE.md

> Workspace: `packages/evidence` · Root rules: [../../CLAUDE.md](../../CLAUDE.md)

## Purpose

Everything the system records about a run: the redacting structured run log, the evidence store
(screenshots, accessibility snapshots, traces) and the run manifests that tie them together. Every record
passes through the `@idp/policy` redaction layer before it is written, so this package is where hard
invariant 3 (redact before any sink) is enforced for logs and evidence, and it serves the evidence and
audit requirements in `docs/requirements.md`.
Shell — empty until its spec lands.

## Owns

- The redacting structured run log (every entry redacted before it is emitted).
- The evidence store: screenshots, accessibility snapshots and traces, referenced by stable evidence refs.
- Run manifests: the per-run index of steps, results and evidence refs.

## Never

- Never writes to any sink (log, file, evidence store) without first passing the data through the
  `@idp/policy` redaction layer.
- Never imports `@idp/surface`, `@idp/session`, `@idp/replay-engine`, `@idp/agent` or any app.
- Never depends on `playwright` or `@anthropic-ai/sdk`.
- Never stores real PII or real credentials — synthetic data only.

## Allowed dependencies

- `@idp/artifact-schema` and `@idp/policy`. No third-party runtime dependencies yet (pino arrives with
  its spec).
- Dev tools (`typescript`, `vitest`, `rimraf`, `@types/node`) are `catalog:` devDependencies;
  versions live in the root `pnpm-workspace.yaml`. `@idp/typescript-config` is a `workspace:*` devDependency.

## Enforcement

The dependency direction is enforced by `pnpm lint`: ESLint `no-restricted-imports` generated from
`tools/repo-checks/layers.json` (source imports) plus `pnpm boundaries` (manifest check, BND001–BND009).
Codes most relevant here:

- BND001 — may depend only on `@idp/artifact-schema` and `@idp/policy`.
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
pnpm --filter @idp/evidence build
pnpm --filter @idp/evidence typecheck
pnpm --filter @idp/evidence test
```

Lint and format are root-only (`pnpm lint`, `pnpm format:check`); there is no per-package lint script.
