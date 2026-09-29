# ADR-0001: Stack and workspace layout

| Field          | Value                                           |
| -------------- | ----------------------------------------------- |
| Status         | Accepted                                        |
| Date           | 2026-09-29                                      |
| Requirements   | D1, R3.1, R7.1, code quality                    |
| Report section | 1                                               |
| Spec           | `_design/monorepo-foundation/spec.md`           |

## Context

The system has three concerns that must not bleed into each other: an LLM discovery loop, a deterministic
replay engine that must never call the model (R3.1), and a `Surface` seam that confines the browser driver so
other surfaces can be added later (R7.1). These properties are graded, and they are easy to break silently with
one stray import. The repo also needs one-command setup, build and test (D1), and later specs should add code,
not plumbing. Legacy targets are reached only over HTTP, so the target app (`mock-bank`) must stay a black box.

## Options

### A. TypeScript monorepo — pnpm workspaces + Turborepo, all 11 workspaces now, boundaries enforced by tooling

- ➕ pnpm's strict isolation: an undeclared import does not resolve, so the manifest graph *is* the import graph.
- ➕ Turborepo gives a small, cached task graph (`build`, `typecheck`, `test`) without a framework surface.
- ➕ All shells exist from day one, so the boundary check has real targets and later specs never touch plumbing.
- ➕ One `layers.json` feeds both the manifest check (`pnpm boundaries`, BND001–BND009) and ESLint
  `no-restricted-imports`, so the two cannot drift. A test proves each rule fails on a bad fixture.
- ➖ Ten near-empty packages in the first diff; more config files to keep consistent.

### B. npm/yarn workspaces, or Nx

- ➕ npm/yarn need no extra tool; Nx has built-in module-boundary lint rules.
- ➖ npm/yarn hoisting allows phantom dependencies, so a package can import what it never declared and the
  manifest check proves nothing. Nx brings a large framework surface for an 11-package repo.

### C. One package, folders + convention (or TS project references)

- ➕ Least setup.
- ➖ "replay never imports agent" becomes a code-review convention; nothing fails when it breaks. Project
  references add a second build graph next to the package graph.

Tooling sub-choices: **Vitest** per workspace (fast, ESM-native); **ESLint + Prettier** over Biome, because
ESLint can express per-workspace import restrictions; **TypeScript 6.0.x**, not 7, because
`typescript-eslint@8.71` supports `typescript <6.1`.

## Decision

Option A. It is the only option where the layering invariants are checked by machines at three levels —
pnpm resolution, the manifest check and lint — rather than by convention.

## Consequences

- **Easier:** proving R3.1 and R7.1 (a test fails the build if `replay-engine` reaches `agent`, even
  transitively); adding code to a spec without touching workspace plumbing; one command per task.
- **Harder:** every new workspace must be added to `tools/repo-checks/layers.json`, or `BND008` fails. The
  diagram in `CLAUDE.md` and `layers.json` must change together. TypeScript is held at 6.0.x until
  typescript-eslint supports 7. Lint is not type-aware yet. The lint rule does not see `require()` or
  non-literal dynamic `import()`; the manifest check and pnpm strict resolution are the backstop.
- **Revisit when:** typescript-eslint supports TS 7; a desktop surface needs a non-Node runtime; lint time
  becomes noticeable and type-aware rules are worth it.
