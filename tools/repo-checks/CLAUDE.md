# CLAUDE.md — `@idp/repo-checks` (tools/repo-checks)

Root rules: [`../../CLAUDE.md`](../../CLAUDE.md). This file only adds what is specific to this workspace.

## Purpose

A **tooling** workspace, not a layer in the dependency direction. It enforces the architecture
boundaries from the root CLAUDE.md and is their structural proof:

- **R3.1 / invariant 1**: `@idp/replay-engine` never reaches `@idp/agent` or `@anthropic-ai/sdk`,
  directly or transitively.
- **R7.1 / invariant 2**: Playwright is confined to `@idp/surface`, and only `@idp/agent` may use the
  Anthropic SDK.

## `layers.json` is the single source of truth

[`layers.json`](layers.json) is the machine-readable form of the root CLAUDE.md dependency diagram. Two
readers use it:

1. this package's manifest check (`pnpm boundaries`), and
2. the root [`eslint.config.js`](../../eslint.config.js), which generates the per-workspace source-import
   rules from it.

Change `layers.json` **together with** the diagram in the root CLAUDE.md. A new workspace that is not
listed in `layers` / `isolated` / `tooling` fails with **BND008**.

## Rule codes

Codes are stable (`src/BoundaryViolation.ts`). A code never changes meaning. New rules get new codes.

| Code   | Rule                  | Fires when                                                                                                                                      |
| ------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| BND001 | `layer-direction`     | An `@idp/*` dependency is not in a strictly lower rank (left) of the depender.                                                                  |
| BND002 | `cycle`               | `@idp/*` workspaces form a cycle (one finding per strongly connected component; tooling edges ignored).                                          |
| BND003 | `mock-bank-isolation` | An isolated workspace depends on any `@idp/*` other than a tooling devDependency, or anything depends on it.                                    |
| BND004 | `playwright-owner`    | A workspace other than the owner declares `playwright` / `playwright-core` / `@playwright/test`, in **any** section (devDependencies included). |
| BND005 | `anthropic-owner`     | A workspace other than `@idp/agent` declares `@anthropic-ai/sdk`, in any section.                                                               |
| BND006 | `forbidden-reach`     | A `forbiddenReach` target is in the transitive closure of `from`. **All four manifest sections count as edges**, devDependencies included.      |
| BND007 | `runtime-allowlist`   | A workspace with a `runtimeAllowlist` entry has a `dependencies` entry outside it (`@idp/artifact-schema` → `zod` only).                          |
| BND008 | `unknown-workspace`   | A workspace, or an `@idp/*` dependency, is not listed in `layers.json`.                                                                           |
| BND009 | `tooling-misuse`      | A tooling package is used as a non-dev dependency, or a tooling package depends on an architecture package.                                     |

## Three layers of defence

1. **pnpm strict isolation**: an undeclared import does not resolve.
2. **Manifest check**: `pnpm boundaries`, which is part of `pnpm lint`. This package.
3. **ESLint** (root config): `no-restricted-imports` per workspace, generated from `layers.json`, plus the
   local rule `idp/no-relative-cross-workspace`.

**Known limitation:** the lint rules do not cover `require()` or dynamic `import()` with a non-literal
specifier. The manifest check and pnpm strict resolution are the backstop.

## Never

- **No runtime dependencies.** Node built-ins only. No Zod: validation is hand-written type guards
  (`src/LayerModel.ts`, `src/readWorkspaceGraph.ts`).
- **Never import an architecture package** (`@idp/*` other than tooling). The check itself reports this
  as BND009.
- **No build step.** The CLI runs through `tsx`, and tests run through `vitest`. `tsconfig.json` is `noEmit`.
- **Do not re-enable the test cache.** The functional tests read the real repo, so this workspace's
  `turbo.json` sets `test.cache: false`. Keep it that way.
- Never throw strings. Config and read failures are `LayersConfigError` / `WorkspaceReadError`, which
  carry a stable `code`.

## Allowed dependencies

`devDependencies` only: `@idp/typescript-config`, `@types/node`, `eslint` (used by the ESLint functional
test), `tsx`, `typescript`, `vitest`.

## Layout

```
layers.json                 the layer model (single source of truth)
src/
  BoundaryViolation.ts      BOUNDARY_RULES, BoundaryCode, BoundaryViolation
  WorkspaceGraph.ts         DEPENDENCY_SECTIONS, DependencySection, WorkspaceNode, WorkspaceGraph
  LayerModel.ts             LayerModel, ForbiddenReach, parseLayerModel, loadLayerModel
  LayersConfigError.ts      typed error, code LAYERS_CONFIG_INVALID
  WorkspaceReadError.ts     typed error, code WORKSPACE_READ_FAILED
  readWorkspaceGraph.ts     reads packages/*, apps/*, tools/* manifests
  checkBoundaries.ts        pure rule engine (BND001–BND009)
  formatViolations.ts       one-line-per-violation renderer
  cli.ts                    `check` entry point (exit codes below)
  index.ts                  barrel
  *.test.ts                 unit tests next to the source
test/
  fixtures/valid-workspace/ on-disk mini repo with @fixture/* names (lib-a, app-b, tool-c, and a dir without a manifest)
  functional/
    repoBoundaries.test.ts   AC3: the real repo has 12 workspaces and zero violations
    eslintBoundaries.test.ts AC6: the root ESLint config rejects forbidden imports
    repoHygiene.test.ts      AC7: .env.example has only empty keys, and .env is git-ignored
```

Broken manifests and broken `layers.json` files are **generated in a temp dir at test time**
(`mkdtempSync`). They are not checked-in fixtures.

## Exemplars to copy

- New rule: add a code to `BOUNDARY_RULES`, implement it in `checkBoundaries.ts` (pure, deterministic
  order), add cases to `checkBoundaries.test.ts`, and update the table above and the README.
- New `layers.json` key: `KNOWN_KEYS` and a guard in `parseLayerModel`, plus a case in `LayerModel.test.ts`.
- Typed error: `LayersConfigError.ts`.

## Commands

```bash
pnpm boundaries                              # = pnpm --filter @idp/repo-checks check (also run by pnpm lint)
pnpm --filter @idp/repo-checks check
pnpm --filter @idp/repo-checks test
pnpm --filter @idp/repo-checks typecheck
```

Exit codes of `check`: **0** OK · **1** violations found · **2** config/read error
(`LAYERS_CONFIG_INVALID` / `WORKSPACE_READ_FAILED`).
