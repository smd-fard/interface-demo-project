# Implementation Plan — Monorepo Foundation

> Source spec: `./spec.md` (branch `feature/monorepo-foundation`, PoC: Mos Fard, requirements: D1, R3.1,
> R7.1, code quality).

## Context
The repo has docs, the SDD workflow and Claude tooling, but no `package.json`. Nothing builds, and the
`/commit` test gate is skipped. This plan creates the pnpm + Turborepo workspace, the shared strict TS
config, 10 empty `@idp/*` shells wired along the dependency direction, and a tested boundary check that
enforces invariants 1 and 2 at the manifest level (declared graph) and at lint time (source imports).

## Approach
Root tooling first (workspace, catalog, Turborepo, TS base), because `scaffold-package` refuses to run
without it. Then the scaffold templates are fixed so every shell is generated identically. Then the 10
shells are scaffolded in parallel and wired with their allowed `@idp/*` edges. Enforcement lives in one
private tooling workspace, `tools/repo-checks` (`@idp/repo-checks`). Its single source of truth,
`layers.json`, is read by the manifest checker (TS) and by the root `eslint.config.js`, so the two checks
cannot drift. The real guarantee is pnpm's strict isolation (an undeclared import does not resolve) plus
the manifest check. Lint gives earlier, per-file feedback. Versions are centralised in a pnpm **catalog**.
TypeScript is pinned to **6.0.x**, not 7.x, because `typescript-eslint@8.71` supports `typescript <6.1`.
The stack and layout go in ADR-0001 (step 12). Deferred: type-aware linting, CI, `pnpm idp` and
`pnpm mock-bank` root scripts (added by the specs that create those entry points), and `zod` in
`artifact-schema` (spec 02).

**Decisions made in this plan (conventional defaults; recorded in ADR-0001 where defendable):**
- Lint and format run **once at the root**, not per package: one flat config, one Prettier run. The
  per-package `lint` script is removed from the scaffold template.
- Shared dev tools (`typescript`, `vitest`, `@types/node`, `rimraf`, `tsx`) are declared per workspace as
  `catalog:` devDependencies, so each package's scripts resolve their own bins. Versions live once in
  `pnpm-workspace.yaml`.
- `@idp/typescript-config` is **tooling**, not a layer. Any workspace may list it as a devDependency,
  including `mock-bank`, because it is `tsconfig` inheritance and no code crosses. It may not appear in
  `dependencies`.
- Turborepo orders builds; there are **no TS project references** (one graph, not two). Each package has
  `tsconfig.json` (noEmit, includes tests and config, used by `typecheck` and the editor) and
  `tsconfig.build.json` (emits `src/` → `dist/`, excludes tests).
- `@types/node` follows the **minimum** runtime (`^22`), not the latest (26), so APIs newer than Node 22
  fail typecheck.
- `pnpm` is pinned to `10.19.0` (installed and verified locally). pnpm 11+ moves settings out of `.npmrc`;
  upgrading is not in scope.

## Implementation steps

### 1. Phase 1 — root: workspace, catalog, Turborepo, engines
Skill: glue
Create / Modify:
- `package.json` (root) — name `interface-demo-project`, `private`, `"type": "module"`,
  `"packageManager": "pnpm@10.19.0"`, `"engines": { "node": ">=22.13" }` (floor set by ESLint 10 at 22.13
  and Vitest 5 at 22.12). Scripts: `build` = `turbo run build`, `typecheck` = `turbo run typecheck`,
  `test` = `turbo run test`, `lint` = `eslint . && pnpm boundaries`, `boundaries` =
  `pnpm --filter @idp/repo-checks check`, `format` = `prettier --write .`, `format:check` =
  `prettier --check .`, `clean` = `turbo run clean && rimraf .turbo`. Root devDependencies (all
  `catalog:`): `turbo`, `typescript`, `eslint`, `@eslint/js`, `typescript-eslint`,
  `eslint-config-prettier`, `globals`, `prettier`, `rimraf`, `@types/node`.
- `pnpm-workspace.yaml` — `packages`: `packages/*`, `apps/*`, `tools/*`. `catalog`: `typescript ~6.0.3`,
  `vitest ^5.0.2`, `@types/node ^22.20.4`, `turbo ^2.11.5`, `eslint ^10.11.0`, `@eslint/js ^10.0.1`,
  `typescript-eslint ^8.71.0`, `eslint-config-prettier ^10.1.8`, `globals ^17.12.0`, `prettier 3.9.9`
  (exact, since formatting output must not drift), `rimraf ^6.1.3`, `tsx ^4.23.15`. If `pnpm install`
  reports ignored build scripts, add only those packages to `onlyBuiltDependencies`.
- `.npmrc` — `engine-strict=true` (wrong Node fails at install with an engine error: spec edge case),
  `auto-install-peers=false`.
- `turbo.json` — `$schema`, `ui: "stream"`, `globalDependencies`: `packages/typescript-config/*.json`,
  `.nvmrc`, `pnpm-workspace.yaml`. Tasks: `build` (dependsOn `^build`, outputs `dist/**`),
  `typecheck` (dependsOn `^build`, no outputs), `test` (dependsOn `^build`, no outputs), `clean`
  (`cache: false`). Default inputs plus both tsconfig files, so a config change invalidates the cache
  (spec edge case).
- `.nvmrc` — unchanged (`22`).

### 2. Phase 1 — typescript-config: strict ESM bases
Skill: TDD (hand-written; `scaffold-package` cannot generate it because its template extends this
package)
Create / Modify:
- `packages/typescript-config/package.json` — `@idp/typescript-config`, private, `"type": "module"`,
  `files: ["*.json"]`, `exports`: `./base.json`. Scripts: `test` only (no build, no typecheck).
  devDependencies: `vitest`, `@types/node` (catalog).
- `packages/typescript-config/base.json` — target and lib `ES2024`; `module` and `moduleResolution`
  `NodeNext`; `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`,
  `noUnusedLocals`, `noUnusedParameters`; `verbatimModuleSyntax`, `isolatedModules`,
  `resolveJsonModule`, `esModuleInterop`, `forceConsistentCasingInFileNames`, `skipLibCheck`;
  `declaration`, `declarationMap`, `sourceMap`; **`types: ["node"]`** (TS 6 defaults `types` to `[]`).
  Never `baseUrl` or `paths` (deprecated in TS 6). `exactOptionalPropertyTypes` is left off on purpose
  (friction with Playwright and Zod option types); revisit in spec 02.
- `packages/typescript-config/vitest.config.ts` — `include: ['test/**/*.test.ts']`, node environment.
- `packages/typescript-config/test/base.test.ts` — see Test plan.
- `packages/typescript-config/CLAUDE.md`, `README.md` — purpose (shared bases only), Never (no
  `baseUrl`/`paths`, no loosening `strict`), how to extend.

### 3. Phase 1 — scaffold-package: align templates with the foundation
Skill: glue
Create / Modify:
- `.claude/skills/scaffold-package/references/package.json.tmpl` — scripts: `build` =
  `tsc -b tsconfig.build.json`, `typecheck` = `tsc --noEmit`, `test` = `vitest run`, `test:watch`,
  `clean` = `rimraf dist`. Remove `lint`. devDependencies: `@idp/typescript-config: workspace:*`,
  `typescript`, `vitest`, `@types/node`, `rimraf`, all `catalog:`.
- `.claude/skills/scaffold-package/references/tsconfig.json.tmpl` — extends
  `@idp/typescript-config/base.json`, `noEmit: true`, includes `src/**/*.ts`, `test/**/*.ts`,
  `vitest.config.ts`.
- `.claude/skills/scaffold-package/references/tsconfig.build.json.tmpl` (**new**) — extends
  `./tsconfig.json`; `noEmit: false`, `incremental: true`, `rootDir: src`, `outDir: dist`,
  `tsBuildInfoFile: dist/.tsbuildinfo` (inside `dist/`, so `clean` never leaves a stale buildinfo that
  skips emit); includes `src/**/*.ts`; excludes `src/**/*.test.ts`.
- `.claude/skills/scaffold-package/scripts/scaffold.sh` — render `tsconfig.build.json`; for `node-app`
  and `web-app`, also add `tsx: catalog:` to devDependencies (the `dev` script already uses it).
- `.claude/skills/scaffold-package/SKILL.md` — Verify step: `pnpm --filter @idp/<name> typecheck` too;
  mention the `catalog:` convention and that lint is root-level; add `tsconfig.build.json.tmpl` to
  References.

### 4. Phase 1 — scaffold the 10 architecture shells
Skill: scaffold-package (parallel; distinct directories)
Create / Modify:
- `packages/artifact-schema` — `scaffold-package packages artifact-schema lib`.
- `packages/policy` — `scaffold-package packages policy lib`.
- `packages/evidence` — `scaffold-package packages evidence lib`.
- `packages/surface` — `scaffold-package packages surface lib`.
- `packages/session` — `scaffold-package packages session lib`.
- `packages/replay-engine` — `scaffold-package packages replay-engine lib`.
- `packages/agent` — `scaffold-package packages agent lib`.
- `apps/cli` — `scaffold-package apps cli node-app`.
- `apps/operator` — `scaffold-package apps operator web-app`.
- `apps/mock-bank` — `scaffold-package apps mock-bank web-app`.
Each shell ends up with `package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`,
`src/index.ts` (`export {}`), `src/index.test.ts` (placeholder), and `CLAUDE.md` + `README.md` filled
from the root workspace map (purpose, Owns, Never, Allowed dependencies per the table in step 5). No
third-party runtime dependencies are added in this spec.

### 5. Phase 1 — wire the allowed `@idp/*` edges, install
Skill: glue
Create / Modify: each shell's `package.json` `dependencies`, all `workspace:*`, exactly:

| Workspace | `@idp/*` dependencies |
| --- | --- |
| `artifact-schema` | none |
| `policy` | `artifact-schema` |
| `evidence` | `artifact-schema`, `policy` |
| `surface` | `artifact-schema`, `policy`, `evidence` |
| `session` | `artifact-schema`, `policy`, `evidence`, `surface` |
| `replay-engine` | `artifact-schema`, `policy`, `evidence`, `surface`, `session` |
| `agent` | `artifact-schema`, `policy`, `evidence`, `surface`, `session` |
| `cli` | `artifact-schema`, `session`, `replay-engine`, `agent` |
| `operator` | `artifact-schema`, `session` |
| `mock-bank` | none (only `@idp/typescript-config` as a devDependency) |

`replay-engine` and `agent` are peers, so neither depends on the other; the same holds for `cli` and
`operator`. Then `pnpm install` generates and commits `pnpm-lock.yaml`. Gate: `pnpm build && pnpm test`.

### 6. Phase 3 — repo-checks: workspace + layer model
Skill: TDD (hand-written; tooling workspace outside `packages/` and `apps/`)
Create / Modify:
- `tools/repo-checks/package.json` — `@idp/repo-checks`, private, `"type": "module"`, **no build**
  (runs through `tsx` and Vitest). Scripts: `check` = `tsx src/cli.ts`, `typecheck` = `tsc --noEmit`,
  `test` = `vitest run`. devDependencies: `@idp/typescript-config`, `typescript`, `vitest`,
  `@types/node`, `tsx`, and `eslint` (for the ESLint API test in step 9), all `catalog:`/`workspace:*`.
  No `@idp/*` runtime dependencies (it reads manifests from disk and never imports architecture
  packages).
- `tools/repo-checks/turbo.json` — extends `//`; `test` has `cache: false`, because its functional tests
  read every manifest, `eslint.config.js`, `.env.example` and `.gitignore` in the repo (the stale-cache
  edge case).
- `tools/repo-checks/tsconfig.json`, `vitest.config.ts` — as the scaffold template (tsconfig includes
  `src`, `test`).
- `tools/repo-checks/layers.json` — **the single source of truth** for the dependency direction:
  `layers` (ordered list of rank groups: `[artifact-schema]`, `[policy]`, `[evidence]`, `[surface]`,
  `[session]`, `[replay-engine, agent]`, `[cli, operator]`); `isolated` (`mock-bank`); `tooling`
  (`typescript-config`, `repo-checks`); `owners` (`playwright`, `playwright-core`, `@playwright/test` →
  `@idp/surface`; `@anthropic-ai/sdk` → `@idp/agent`); `runtimeAllowlist` (`@idp/artifact-schema` →
  `zod`); `forbiddenReach` (`@idp/replay-engine` ↛ `@idp/agent`; `@idp/replay-engine` ↛
  `@anthropic-ai/sdk`). Every name is fully qualified (`@idp/...`).
- `tools/repo-checks/src/LayerModel.ts` — `LayerModel` type (the parsed `layers.json`) + `loadLayerModel(path)`,
  which reads and validates the shape with a hand-written guard (no Zod: tooling stays dependency-free)
  and throws `LayersConfigError`.
- `tools/repo-checks/src/LayersConfigError.ts` — typed error, `code = 'LAYERS_CONFIG_INVALID'`, names the
  bad key.
- `tools/repo-checks/src/WorkspaceGraph.ts` — types `WorkspaceNode` (`name`, `dir`, `dependencies`,
  `devDependencies`, `peerDependencies`, `optionalDependencies`) and `WorkspaceGraph` (map by name).
- `tools/repo-checks/src/readWorkspaceGraph.ts` — `readWorkspaceGraph(root)`: lists
  `packages/*/package.json`, `apps/*/package.json`, `tools/*/package.json` (the same globs as
  `pnpm-workspace.yaml`) with `fs.readdirSync`, and parses them. Throws `WorkspaceReadError`
  (`code = 'WORKSPACE_READ_FAILED'`, with path) on unreadable or invalid JSON.
- `tools/repo-checks/src/WorkspaceReadError.ts` — typed error as above.
- `tools/repo-checks/src/index.ts` — barrel.

### 7. Phase 3 — repo-checks: manifest boundary rules
Skill: TDD
Create / Modify:
- `tools/repo-checks/src/BoundaryViolation.ts` — `BoundaryViolation` type: `code`, `rule` (human name),
  `package`, `dependency`, `section` (which manifest field), `path` (edge chain for transitive
  findings), `message`. Stable codes:
  - `BND001 layer-direction` — an `@idp/*` dependency (any section) whose rank is not strictly left of
    the dependent (covers same-rank peers and right-pointing edges). Tooling is exempt as a devDependency.
  - `BND002 cycle` — a cycle in the `@idp/*` graph, reported with the full path.
  - `BND003 mock-bank-isolation` — `@idp/mock-bank` has any `@idp/*` dependency other than
    `@idp/typescript-config` in devDependencies, or any workspace depends on `@idp/mock-bank`.
  - `BND004 playwright-owner` — `playwright`, `playwright-core` or `@playwright/test` in **any**
    section of any manifest other than `@idp/surface` (PoC decision: dev dependencies included).
  - `BND005 anthropic-owner` — `@anthropic-ai/sdk` in any section outside `@idp/agent`.
  - `BND006 forbidden-reach` — the transitive `@idp/*` closure of a `forbiddenReach.from` package
    contains the `to` package, or any closure member directly depends on a forbidden third-party `to`.
    Reports the chain (e.g. `@idp/replay-engine → @idp/session → @idp/agent`).
  - `BND007 runtime-allowlist` — a package in `runtimeAllowlist` has a `dependencies` entry outside its
    list (`@idp/artifact-schema`: `zod` only).
  - `BND008 unknown-workspace` — a workspace not named in `layers`, `isolated` or `tooling`. This forces
    `layers.json` to be updated when a package is added.
  - `BND009 tooling-misuse` — a tooling package in `dependencies` (not devDependencies), or a tooling
    package that depends on an architecture package.
- `tools/repo-checks/src/checkBoundaries.ts` — `checkBoundaries(graph, model): BoundaryViolation[]`. Pure,
  deterministic order (sorted by code, then package), no I/O.
- `tools/repo-checks/src/formatViolations.ts` — renders violations as one line each:
  `<code> <rule>: <package> → <dependency> (<section>) — <message>`.
- `tools/repo-checks/src/cli.ts` — resolves the repo root (walks up to `pnpm-workspace.yaml`), loads the
  model and graph, and prints violations or `boundaries: OK (<n> workspaces)`. Exit code 1 on any
  violation, 2 on a `LayersConfigError`/`WorkspaceReadError` (message printed, never swallowed).

### 8. Phase 3 — root lint and format config
Skill: glue
Create / Modify:
- `eslint.config.js` — flat config, ESM. Ignores `**/dist/**`, `**/.turbo/**`, `**/coverage/**`,
  `evidence/**`, `.claude/**`. Base: `@eslint/js` recommended + `typescript-eslint` `strict` and
  `stylistic` (**not** type-checked: fast, no per-package project service; deferred) + `globals.node`.
  Project rules: `@typescript-eslint/consistent-type-imports`, `no-console` off only in
  `tools/repo-checks/src/cli.ts`. **Boundary block:** reads `tools/repo-checks/layers.json` (JSON import
  with `with { type: 'json' }`) and scans `packages/*`, `apps/*`, `tools/*` manifests to map name → dir.
  For each workspace it emits **one** config object (`files: ['<dir>/**/*.ts']`) with a single
  `no-restricted-imports` entry whose `patterns` merge every rule for that workspace:
  `@idp/*` names not strictly left (and not tooling); every `@idp/*` for `mock-bank`; `playwright*`
  outside `surface`; `@anthropic-ai/sdk` outside `agent`; and relative paths into sibling workspaces
  (`**/packages/**`, `**/apps/**`, `**/tools/**` via `../`). One merged object per workspace matters
  because later flat-config objects replace a rule's options rather than merging them. Each message
  cites the rule code (e.g. `BND001`). `eslint-config-prettier` goes last.
- `.prettierrc.json` — `useTabs: true`, `singleQuote: true`, `printWidth: 120`, `trailingComma: "all"`
  (matches the existing templates).
- `.prettierignore` — `**/*.md` (prose and tables are hand-formatted; this avoids a repo-wide docs
  reflow), `pnpm-lock.yaml`, `**/dist`, `.turbo`, `coverage`, `evidence/`.
- Run `pnpm format` once so `format:check` starts green. Expect small whitespace changes in `.mcp.json`
  and `.claude/settings.json`.

### 9. Phase 3 — repo-checks: tests for lint boundaries and repo hygiene
Skill: TDD
Create / Modify:
- `tools/repo-checks/test/functional/eslintBoundaries.test.ts` — see Test plan (AC6).
- `tools/repo-checks/test/functional/repoBoundaries.test.ts` — see Test plan (AC3).
- `tools/repo-checks/test/functional/repoHygiene.test.ts` — see Test plan (AC7).

### 10. Phase 3 — environment template
Skill: glue
Create / Modify:
- `.env.example` — `ANTHROPIC_API_KEY=` (discovery only; replay and tests never need it) and
  `CONTEXT7_API_KEY=` (optional, developer docs MCP, read by `.mcp.json`), each with a one-line comment.
  Empty values only. `.gitignore` already ignores `.env` and `.env.*` and re-includes `.env.example`; no
  change.

### 11. Phase 7 — docs: root and per-workspace
Skill: update-docs (root, plus each new workspace in parallel)
Create / Modify:
- `README.md` — Setup: Node ≥ 22.13 (`nvm use`), `corepack enable` (pnpm version comes from
  `packageManager`), `pnpm install`, `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm format:check`.
  Configuration: `cp .env.example .env`, and only discovery needs `ANTHROPIC_API_KEY`. Remove "TBD" from
  Setup; Demo path stays TBD (`cli-demo-path`).
- `CLAUDE.md` (root) — the workspace map status becomes "scaffolded, shells empty until their spec";
  add `tools/repo-checks` (tooling, not in the dependency direction) and note that `layers.json` is the
  machine-readable form of the dependency direction and must change together with the diagram. Commands:
  real, add `pnpm format`, `pnpm format:check`, `pnpm boundaries`; mark `pnpm mock-bank` and `pnpm idp` as
  "added by their specs".
- `packages/*/CLAUDE.md`, `apps/*/CLAUDE.md`, `tools/repo-checks/CLAUDE.md` + `README.md` — confirm
  Allowed dependencies match step 5 and Never lists the relevant invariants (for example, `replay-engine`
  never depends on `agent`, directly or transitively).
- `.claude/settings.json` — allow `Bash(pnpm format:*)` and `Bash(pnpm boundaries:*)`.

### 12. Phase 7 — ADR-0001
Skill: glue (follow `.claude/commands/define-adr.md` with `docs/adr/0000-template.md`)
Create / Modify:
- `docs/adr/0001-stack-and-workspace-layout.md` — decision: TypeScript on Node 22, pnpm workspaces +
  Turborepo, Vitest, ESLint + Prettier, all 11 shells up front, boundaries enforced by `layers.json`
  (manifest check + lint + pnpm strict isolation). Alternatives: npm/yarn workspaces, Nx, Biome,
  convention-only boundaries, TS project references. The Consequences section covers what gets harder:
  every new workspace must be added to `layers.json` or `BND008` fails; TypeScript is held at 6.0.x until
  typescript-eslint supports 7; lint is not type-aware yet. Report section: 1 (Architecture).
- `docs/adr/README.md` — add the row.
- `_design/monorepo-foundation/spec.md` — link ADR-0001 under Decisions.

## Invariant check
- No LLM on replay path — structurally enforced from day one: `BND006` forbids `@idp/replay-engine`
  reaching `@idp/agent` or `@anthropic-ai/sdk` transitively, `BND005` confines the SDK to `agent`, and
  lint rejects the import in source (AC4, AC6).
- Every action through policy — no action types exist yet. `BND004` plus the lint rule keep Playwright
  inside `@idp/surface`, the precondition for "no raw `page.click` outside surface".
- Redact before any sink — not touched (no sinks). `.env.example` holds empty values only, and a test
  asserts it.
- Business outcome ≠ failure — not touched.
- Checkpoints — not touched.
- Schema is a public contract — not touched. `artifact-schema` is an empty shell; `BND007` already pins
  its runtime deps to `zod`.
- Synthetic data only — not touched. No data or network in tests; no browser download.

## Critical files
**To create**
- `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.npmrc`, `turbo.json`, `eslint.config.js`,
  `.prettierrc.json`, `.prettierignore`, `.env.example`
- `packages/typescript-config/{package.json, base.json, vitest.config.ts, test/base.test.ts, CLAUDE.md, README.md}`
- 10 shells under `packages/{artifact-schema, policy, evidence, surface, session, replay-engine, agent}` and
  `apps/{cli, operator, mock-bank}` (each: `package.json`, `tsconfig.json`, `tsconfig.build.json`,
  `vitest.config.ts`, `src/index.ts`, `src/index.test.ts`, `CLAUDE.md`, `README.md`)
- `tools/repo-checks/{package.json, turbo.json, tsconfig.json, vitest.config.ts, layers.json, CLAUDE.md, README.md}`
- `tools/repo-checks/src/{LayerModel.ts, LayersConfigError.ts, WorkspaceGraph.ts, readWorkspaceGraph.ts, WorkspaceReadError.ts, BoundaryViolation.ts, checkBoundaries.ts, formatViolations.ts, cli.ts, index.ts}` + co-located tests
- `tools/repo-checks/test/fixtures/` (on-disk mini workspaces) and `tools/repo-checks/test/functional/*.test.ts`
- `.claude/skills/scaffold-package/references/tsconfig.build.json.tmpl`
- `docs/adr/0001-stack-and-workspace-layout.md`

**To modify**
- `.claude/skills/scaffold-package/references/{package.json.tmpl, tsconfig.json.tmpl}`, `scripts/scaffold.sh`,
  `SKILL.md` (build/typecheck split, catalog devDeps, no per-package lint)
- `README.md` (Setup), `CLAUDE.md` (map status, repo-checks, commands), `.claude/settings.json`
  (permissions), `docs/adr/README.md` (row), `_design/index.md` (status), `spec.md` (ADR link)

## Test plan
- `packages/typescript-config/test/base.test.ts` — `base.json` has `strict`, `noUncheckedIndexedAccess`,
  `module`/`moduleResolution` `NodeNext`, `verbatimModuleSyntax`, `types` containing `node`, and no
  `baseUrl`/`paths`. Guards against silent loosening.
- `packages/*/src/index.test.ts`, `apps/*/src/index.test.ts` (10) — placeholder: the barrel loads (AC1).
- `tools/repo-checks/src/LayerModel.test.ts` — the real `layers.json` loads; a model missing `layers`, a
  name without the `@idp/` scope, or a name in two ranks throws `LayersConfigError` with code
  `LAYERS_CONFIG_INVALID`.
- `tools/repo-checks/src/readWorkspaceGraph.test.ts` — against `test/fixtures/valid-workspace/`: finds
  every manifest under the three globs, maps all four dependency sections; a fixture with a broken
  `package.json` throws `WorkspaceReadError` naming the path.
- `tools/repo-checks/src/checkBoundaries.test.ts` — in-memory graphs built from the real `layers.json`:
  - a correct graph (mirroring step 5) → no violations;
  - **AC4**: `replay-engine → session → agent` → `BND006` naming `@idp/replay-engine` and `@idp/agent`
    with the chain (plus `BND001` for `session → agent`);
  - **AC5a** `mock-bank → artifact-schema` → `BND003`; **AC5b** `policy` with `playwright` (as
    devDependency) → `BND004`; **AC5c** `surface` with `@anthropic-ai/sdk` → `BND005`; **AC5d**
    `artifact-schema` with runtime `lodash` → `BND007`; **AC5e** `policy → evidence` → `BND001`;
  - peers: `replay-engine → agent` directly → `BND001` + `BND006`; `cli → operator` → `BND001`;
  - a two-node cycle → `BND002`; an unlisted `@idp/foo` → `BND008`; `@idp/typescript-config` in
    `dependencies` → `BND009`; `mock-bank` with `@idp/typescript-config` as devDependency → no violation;
  - output is sorted and stable (same input, same order).
- `tools/repo-checks/src/formatViolations.test.ts` — one line per violation; contains code, rule,
  package, dependency, section.
- `tools/repo-checks/test/functional/repoBoundaries.test.ts` — **AC3**: `readWorkspaceGraph(repoRoot)` +
  `checkBoundaries` → zero violations; exactly 12 workspaces (11 + repo-checks); and every shell's
  `@idp/*` dependencies are a subset of its strictly-left ranks.
- `tools/repo-checks/test/functional/eslintBoundaries.test.ts` — **AC6** via the ESLint Node API
  (`lintText` with a virtual `filePath` under the repo, config from the repo root): `import '@idp/agent'`
  in `packages/replay-engine/src/x.ts` → a `no-restricted-imports` error citing `BND001`;
  `import '@idp/session'` in the same file → no error; `import 'playwright'` in `packages/policy/src/x.ts`
  → error; `import '@idp/policy'` in `apps/mock-bank/src/x.ts` → error; a relative import into a sibling
  workspace → error; `import type` from a forbidden package → error.
- `tools/repo-checks/test/functional/repoHygiene.test.ts` — **AC7**: `.env.example` exists and every
  non-comment line matches `KEY=` with an empty value; `git check-ignore -q .env` exits 0 (local git, no
  network); `.env.example` is not ignored.

No test launches a browser, starts `mock-bank`, or calls a model.

## Verification
1. `nvm use` (Node 22.x), `corepack enable`, then `pnpm install` (lockfile created; no engine or peer
   errors).
2. `pnpm build` — 10 shells emit `dist/index.js` + `dist/index.d.ts`; `typescript-config` and
   `repo-checks` have no build task.
3. `pnpm test` — 12 workspaces pass (AC1, AC3–AC7).
4. `pnpm typecheck && pnpm lint && pnpm format:check` — each exits 0 (AC2). `pnpm lint` ends with
   `boundaries: OK (12 workspaces)`.
5. Smoke, boundary check fails loudly: temporarily add `"@idp/agent": "workspace:*"` to
   `packages/replay-engine/package.json`, run `pnpm boundaries` → exit 1 with `BND001` and `BND006`
   lines. Revert, and `pnpm boundaries` exits 0.
6. Smoke, cache: rerun `pnpm build` → Turborepo reports all tasks cached (`FULL TURBO`). Touch
   `packages/typescript-config/base.json` → the next build is a cache miss.
7. `git check-ignore .env` prints `.env`. `README.md` Setup contains no "TBD" (AC8).
   `docs/adr/0001-stack-and-workspace-layout.md` exists and is listed in `docs/adr/README.md` (AC9).

## Evidence
- n/a. Every AC is covered by the tests above or by the file checks in Verification step 7. Nothing goes
  in `evidence/`.

## Open items the spec already calls out (no plan change needed)
- CI (GitHub Actions) is out of scope; the gates are local (`/commit` runs `pnpm build && pnpm test`).
  Consider adding `pnpm lint` to the `/commit` gate once this lands (a one-line change to
  `.claude/commands/commit.md`, left for the PoC).
- Playwright browser install is a documented setup step owned by `web-surface`, not this spec.
- `zod` enters `artifact-schema` in spec 02; `BND007` already allows it.

## Risks / things to watch during execution
- **TypeScript 7 vs 6:** `npm` "latest" is 7.0.2, but `typescript-eslint@8.71` peers `typescript <6.1`.
  The catalog pins `~6.0.3`; an agent that "upgrades to latest" breaks lint. TS 6 defaults `types` to
  `[]` (hence the explicit `types: ["node"]` in `base.json`) and deprecates `baseUrl` and `node10`
  resolution.
- **Local Node is 24, `.nvmrc` is 22:** gates must run under 22 (`nvm use`), or engine checks and
  `@types/node@22` mismatches go unnoticed. `engine-strict` only enforces the floor.
- **pnpm 10 build-script blocking:** if `pnpm install` warns about ignored build scripts (e.g. `esbuild`
  via Vite), add exactly those packages to `onlyBuiltDependencies` in `pnpm-workspace.yaml`. Do not
  enable all.
- **`apps/cli` `bin`** points at `dist/index.js`, which does not exist at first install. pnpm may warn;
  this is harmless because nothing depends on `@idp/cli`. Do not "fix" it by committing `dist/`.
- **Flat-config override semantics** (`eslint.config.js`): a second object matching the same files
  replaces `no-restricted-imports` options. Emit exactly one boundary object per workspace. Dynamic
  `import()` and `require` are not covered by the rule; the manifest check plus pnpm strict resolution
  are the backstop, and this is documented in `tools/repo-checks/CLAUDE.md`.
- **Turbo cache staleness:** `repo-checks` tests read files across the repo, hence `cache: false` in
  `tools/repo-checks/turbo.json`. Config changes are covered by `globalDependencies`.
- **Prettier first run** (step 8) may reformat `.mcp.json` and `.claude/settings.json`. Review that diff;
  it must be whitespace only.
- **Scaffold template drift:** step 3 must land before step 4, or the shells are generated with the old
  single-tsconfig layout. `implement-plan` enforces this through phase ordering; keep step 3 sequential.
- **JSON import attributes** in `eslint.config.js` need Node ≥ 22 (supported). The TS side reads
  `layers.json` with `fs`, not `import`, so `rootDir` is not an issue since `repo-checks` has no build.
