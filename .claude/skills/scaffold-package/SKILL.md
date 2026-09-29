---
name: scaffold-package
description: Bootstrap a new workspace package at packages/<name> or apps/<name> (@idp/<name>) with package.json, tsconfig, vitest config, barrel, CLAUDE.md and README stubs, and register it in pnpm-workspace.yaml. Use when a plan says "scaffold packages/<n>" / "scaffold apps/<n>", or the user asks to "create a new package/app". Only for brand-new workspaces. Args expected -- "<packages|apps> <name> [lib|node-app|web-app]", e.g. "packages replay-engine lib".
---

# scaffold-package

Creates `<kind>/<name>/` with the canonical shape. The copy and substitute step is done by
`scripts/scaffold.sh`. This file covers validation and the steps the script can't do.

## Args

- `<kind>`: `packages` (libraries) or `apps` (runnable: `cli`, `operator`, `mock-bank`).
- `<name>`: kebab-case. It becomes `@idp/<name>`.
- `[flavor]`: `lib` (default for packages), `node-app` (a CLI or server with a `start` script) or `web-app`
  (a server that serves HTML: `operator`, `mock-bank`).

## Hard rules

- **Respect the dependency direction** in the root `CLAUDE.md`. Add `@idp/*` deps (`workspace:*`) only on
  packages to the left. `apps/mock-bank` gets **no** `@idp/*` deps at all.
- Only `@idp/surface` may depend on `playwright`. Only `@idp/agent` may depend on `@anthropic-ai/sdk`.
  `@idp/artifact-schema` may depend only on `zod`.
- ESM (`"type": "module"`), strict TS, `exports` pointing at `dist/`. Two tsconfigs: `tsconfig.json`
  (`noEmit`, includes tests and `vitest.config.ts`; used by `typecheck` and the editor) and
  `tsconfig.build.json` (emits `src/` → `dist/`, excludes tests). Build is `tsc -b tsconfig.build.json`.
- Shared dev tools (`typescript`, `vitest`, `@types/node`, `rimraf`, and `tsx` for apps) are declared as
  `catalog:` devDependencies; versions live once in the `catalog` of `pnpm-workspace.yaml`. Third-party
  runtime deps should be added to the catalog too and referenced as `catalog:`.
- There is no per-package `lint` script. Lint and format run once at the root (`pnpm lint`,
  `pnpm format:check`).
- Every new workspace must be added to `tools/repo-checks/layers.json`, or the boundary check fails with
  `BND008`.
- Tests: Vitest. Unit tests go next to the source; functional tests go in `test/functional/`.

## Steps

1. **Validate.** `<kind>/<name>` does not exist, and `@idp/<name>` is not referenced in `pnpm-workspace.yaml`.
   Root tooling (`pnpm-workspace.yaml`, `tsconfig.base.json` or `packages/typescript-config`) must exist.
   If it doesn't, the task belongs to `monorepo-foundation`; stop and say so, unless you are scaffolding
   `typescript-config` itself as part of that spec.
2. **Run** `bash .claude/skills/scaffold-package/scripts/scaffold.sh <kind> <name> <flavor>`. It copies
   `references/*.tmpl` with `__NAME__` (kebab), `__PASCAL__` (PascalCase) and `__KIND__` substituted, and
   writes an empty barrel.
3. **Fill** the CLAUDE.md stub: purpose (one paragraph, from the plan), what it owns, what it must never do
   (from the invariants), and its allowed deps. Fill the README stub's one-line purpose.
4. **Deps.** Add the runtime deps the plan names to the new `package.json` (latest stable; use Context7 or
   `pnpm view <pkg> version` when unsure). Add `@idp/*` deps as `workspace:*`.
5. **Register.** Make sure `pnpm-workspace.yaml` covers the path (the default globs `packages/*` and `apps/*`
   already do; if the file lists paths explicitly, add it alphabetically).
6. **Verify.** `pnpm install && pnpm --filter @idp/<name> build && pnpm --filter @idp/<name> typecheck &&
   pnpm --filter @idp/<name> test`. An empty package must build and typecheck, and its placeholder test
   must pass.
7. **Report:**
   ```
   Package: @idp/<name> (<kind>/<name>, <flavor>)
   Deps:    <list>
   Next:    <the plan's next step for this package>
   ```

## References

@references/package.json.tmpl
@references/tsconfig.json.tmpl
@references/tsconfig.build.json.tmpl
@references/vitest.config.ts.tmpl
@references/index.test.ts.tmpl
@references/CLAUDE.md.tmpl
@references/README.md.tmpl
@scripts/scaffold.sh
