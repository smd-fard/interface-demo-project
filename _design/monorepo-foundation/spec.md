# Spec for monorepo-foundation

branch: `feature/monorepo-foundation`

| Field             | Value                                                                                                                                                                                                                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PoC               | Mos Fard                                                                                                                                                                                                                                                                                                                         |
| Date              | 2026-09-28                                                                                                                                                                                                                                                                                                                       |
| Status            | Draft                                                                                                                                                                                                                                                                                                                            |
| Requirements      | D1 (setup), R3.1 (boundary proof: replay-engine ↛ agent), R7.1 (Playwright confined to `surface`), code quality                                                                                                                                                                                                                  |
| Affected packages | **new** root workspace (pnpm + Turborepo + lint/format/test tooling); **new** `packages/typescript-config`, `packages/artifact-schema`, `packages/policy`, `packages/evidence`, `packages/surface`, `packages/session`, `packages/replay-engine`, `packages/agent`, `apps/cli`, `apps/operator`, `apps/mock-bank` (empty shells) |
| Contract impact   | None. No schema exists yet; `@idp/artifact-schema` is an empty shell.                                                                                                                                                                                                                                                            |
| Safety impact     | None at runtime (no action types, no sinks). Adds `.env.example` with placeholder keys only, and an automated boundary check that protects invariants 1 (no LLM on replay path) and 2 (Playwright only in `surface`).                                                                                                            |

---

## Summary

Today the repo holds only docs, the SDD workflow and Claude tooling. There is no `package.json`, so nothing
builds, nothing is tested, and the `/commit` test gate is skipped.

After this change the repo is a pnpm + Turborepo TypeScript monorepo with one command each for install,
build, typecheck, lint, format and test. Every workspace in the CLAUDE.md map exists as an empty,
buildable, tested shell that declares only the dependencies it is allowed to have. A dependency-boundary
check fails the build when a package reaches to its right, when `mock-bank` touches `@idp/*`, or when
Playwright or the Anthropic SDK leaks outside its owner.

This matters to the through-line because the boundary check is the structural proof of "no LLM on the
replay path" (R3.1) and of the `Surface` seam (R7.1) from day one, before any code can erode them. It
also turns on the test gate for every later spec.

## Functional Requirements

- FR1 — From a clean clone with Node ≥ 22 and pnpm, `pnpm install` succeeds with a committed lockfile and
  a pinned package manager version. (D1)
- FR2 — Root scripts `build`, `typecheck`, `lint`, `format`, `format:check`, `test` run across all
  workspaces through Turborepo, respecting inter-package build order. (D1, code quality)
- FR3 — `@idp/typescript-config` provides shared strict ESM `tsconfig` bases that every other workspace
  extends. (code quality)
- FR4 — Each of the 10 remaining workspaces in the CLAUDE.md map exists as an `@idp/<name>` shell with an
  empty barrel, a placeholder unit test, a `CLAUDE.md` and a `README.md`, and builds and tests green.
  (D1, code quality)
- FR5 — Each shell declares exactly the `@idp/*` workspace dependencies the dependency direction allows it
  (packages to its left, none for `mock-bank`), so the build graph mirrors the architecture. (R3.1, R7.1)
- FR6 — A dependency-boundary check runs as part of `pnpm lint` (or `pnpm test`) and fails with a message
  naming the offending package and dependency when any of these holds:
  - a workspace depends on an `@idp/*` package to its right, or a cycle exists;
  - `apps/mock-bank` depends on any `@idp/*` package, or any workspace depends on `@idp/mock-bank`;
  - `playwright` / `@playwright/test` is a runtime dependency outside `@idp/surface`;
  - `@anthropic-ai/sdk` is a dependency outside `@idp/agent`;
  - `@idp/replay-engine` depends on `@idp/agent` directly or transitively;
  - `@idp/artifact-schema` has a runtime dependency other than `zod`.
    (R3.1, R7.1)
- FR7 — ESLint (typescript-eslint, flat config) and Prettier are configured at the root. Source imports
  that cross the boundary rules above are also rejected at lint time, not only in `package.json`.
  (code quality)
- FR8 — `.env.example` lists the configuration keys the project will need (e.g. `ANTHROPIC_API_KEY`) with
  empty placeholder values. `.env` stays gitignored. (D1, D4)
- FR9 — The root `README.md` Setup section documents the prerequisites and the install/build/test
  commands. `CLAUDE.md` marks the workspace map and commands as real, not planned. (D1)
- FR10 — ADR-0001 records the stack and workspace layout. (code quality)

## Non-Functional Requirements

- **Deterministic tooling:** pinned `packageManager`, committed lockfile, `.nvmrc` = 22. Builds are
  reproducible offline once dependencies are installed.
- **Fast gate:** a clean `pnpm build && pnpm test` on the empty workspace finishes in well under a minute
  on a laptop. Turborepo caching makes a no-op rerun near-instant.
- **No network in tests:** no test downloads browsers or calls an LLM. Playwright browser install is a
  documented setup step, not a test side effect.
- **Strict TS everywhere:** `strict`, `noUncheckedIndexedAccess`, ESM `NodeNext` resolution, no emitted
  JS from test files.

## Decisions

- **pnpm workspaces + Turborepo** over npm/yarn workspaces or Nx: strict dependency isolation (no phantom
  deps, which is what makes the boundary check meaningful) and a lightweight task graph without Nx's
  framework surface. → ADR-0001.
- **ESLint + Prettier** over Biome: ESLint can enforce source-level import boundaries
  (`no-restricted-imports` per workspace), which Biome cannot express as cleanly. The scaffold templates
  already assume `eslint`. → ADR-0001.
- **All 11 shells now** over scaffolding per spec: the boundary check has real targets immediately, and
  later specs only add code, never workspace plumbing. Cost: ten near-empty packages in the first diff.
- **Automated boundary check** over convention-only: invariants 1 and 2 are the most graded properties
  and the cheapest to break silently. The check reads `package.json` manifests (declared graph) and lint
  covers source imports (actual graph). A test runs the check against a deliberately bad fixture so the
  check itself is proven to fail. → ADR-0001 (layout section), or a separate ADR if the plan makes it
  large.
- **Vitest per workspace, orchestrated by Turborepo** over a single root Vitest project: each package
  keeps its own config and its tests run in isolation. (Conventional default; not ADR-worthy.)
- **No Playwright in any manifest except `@idp/surface`**, dev dependencies included (PoC, 2026-09-28).
  Functional tests in other packages reach the browser only through `@idp/surface`, so the boundary check
  treats `playwright`, `playwright-core` and `@playwright/test` in any dependency section outside `surface`
  as a violation.
- **Remote exists; branches stay local** (PoC, 2026-09-28). `origin` is configured. `CLAUDE.md` and
  `/define-spec` describe that instead of "no remote". Feature branches are not pushed by Claude; the PoC
  pushes.
- ADR: [ADR-0001 Stack and workspace layout](../../docs/adr/0001-stack-and-workspace-layout.md).

## Possible Edge Cases

- Wrong Node version (e.g. 20) → install or build should fail early with a clear engine error, not a
  cryptic TS error.
- pnpm not installed → README points to Corepack (`corepack enable`).
- A shell with no source but a `tsc -b` build → must still produce `dist/` and not fail on an empty
  program.
- Transitive violation: `replay-engine → session → agent` must be caught, not only direct deps.
- `playwright` added as a **devDependency** in another package for tests → a violation (see Decisions).
- Turborepo cache hides a failing test after a config change → `turbo.json` inputs must include config
  files.

## Acceptance Criteria

- AC1 — Given a clean clone on Node 22, when `pnpm install && pnpm build && pnpm test` runs, then it exits
  0 and every one of the 11 workspaces reports a passing placeholder test.
- AC2 — Given the workspace, when `pnpm typecheck`, `pnpm lint` and `pnpm format:check` run, then each
  exits 0.
- AC3 — Given each workspace's `package.json`, when the boundary check runs, then it passes, and each
  shell's `@idp/*` deps are a subset of the packages to its left in the dependency direction.
- AC4 — Given a fixture workspace graph where `replay-engine` depends on `agent` transitively (via
  `session`), when the boundary check runs on it, then it fails and names `@idp/replay-engine` and
  `@idp/agent`.
- AC5 — Given fixtures where (a) `mock-bank` depends on `@idp/artifact-schema`, (b) `policy` depends on
  `playwright`, (c) `surface` depends on `@anthropic-ai/sdk`, (d) `artifact-schema` depends on a non-`zod`
  runtime package, (e) `policy` depends on `evidence`, when the boundary check runs on each, then each
  fails with a message naming the rule broken.
- AC6 — Given a source file in `@idp/replay-engine` that imports `@idp/agent`, when `pnpm lint` runs, then
  it reports an error.
- AC7 — Given the repo, when `.env.example` is inspected, then it contains only keys with empty values,
  and `git check-ignore .env` confirms `.env` is ignored.
- AC8 — Given `README.md`, then its Setup section lists Node ≥ 22, pnpm via Corepack, `pnpm install`,
  `pnpm build`, `pnpm test`, and no longer says "TBD" for setup.
- AC9 — Given `docs/adr/`, then ADR-0001 exists and is listed in `docs/adr/README.md`.

## Evidence

- n/a. AC1–AC7 are covered by the build, lint and the boundary-check tests; AC8–AC9 by file inspection
  during `/safety-review`.

## Out of Scope

- Any real code in the shells (schemas, Surface, policy, …): specs 02–10.
- Installing Playwright browsers or running a browser in CI/tests: `web-surface`.
- CI pipeline (GitHub Actions). Local gates only; could be added before submission if time allows.
- Release/versioning tooling (changesets), publishing, Docker.
- Pre-commit hooks (husky/lint-staged): `/commit` already runs the gate.

## Open Questions

- None. Both questions raised at spec time were resolved by the PoC on 2026-09-28 and are recorded under
  Decisions.
