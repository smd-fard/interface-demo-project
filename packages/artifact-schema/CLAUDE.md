# @idp/artifact-schema — CLAUDE.md

> Workspace: `packages/artifact-schema` · Root rules: [../../CLAUDE.md](../../CLAUDE.md)

## Purpose

**The contracts.** Zod schemas and inferred types for the capability artifact — locators, steps,
params/outputs, checkpoints, outcome rules — and the replay **result contract**
(`success | business_outcome | failure`), plus their JSON Schema export. It is the leftmost layer:
every other package builds on these contracts. Serves R2 (capability artifact), the R3 result
contract, and invariant 6 (the artifact schema is a public contract).

**Status:** Shell — empty until spec 02 (artifact contracts).

## Owns

- Zod schemas + `z.infer` types (`<Thing>Schema` / `<Thing>`) for the capability artifact and its parts.
- The replay result contract (discriminated union on `kind`).
- The JSON Schema export and the `schemaVersion` (semver) of the artifact.

## Never

- Never add a runtime dependency other than `zod` (boundary check BND007).
- Never import any other `@idp/*` package — this is the leftmost layer.
- Never change the artifact schema without bumping `schemaVersion` (semver) and updating the JSON Schema
  export, fixtures and tests (skill `define-schema`).
- Never store concrete sensitive values in artifacts — only parameter references like `{{memberId}}`.

## Allowed dependencies

- `@idp/*`: none (leftmost layer).
- Third-party runtime: `zod` only (added in spec 02).
- Dev tools (`typescript`, `vitest`, `rimraf`, `@types/node`) are `catalog:` devDependencies;
  versions live in the root `pnpm-workspace.yaml`. `@idp/typescript-config` is a `workspace:*` devDependency.

## Enforcement

The dependency direction is enforced by `pnpm lint`: ESLint `no-restricted-imports` generated from
`tools/repo-checks/layers.json` (source imports) plus `pnpm boundaries` (manifest check, BND001–BND009).
Codes most relevant here:

- BND001 — leftmost layer: it may not depend on any other `@idp/*` architecture package.
- BND007 — runtime `dependencies` are limited to `zod` (allowlist in `layers.json`).

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
pnpm --filter @idp/artifact-schema build
pnpm --filter @idp/artifact-schema typecheck
pnpm --filter @idp/artifact-schema test
```

Lint and format are root-only (`pnpm lint`, `pnpm format:check`); there is no per-package lint script.
