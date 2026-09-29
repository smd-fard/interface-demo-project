# CLAUDE.md — @idp/typescript-config

> Workspace: `packages/typescript-config` · Root rules: [../../CLAUDE.md](../../CLAUDE.md)

Shared `tsconfig` bases for every `@idp/*` workspace. It holds JSON config only: no source, no build,
no runtime code. It is **tooling, not a layer** (listed under `tooling` in `tools/repo-checks/layers.json`).

## Rules

- `base.json` is the single strict ESM base (Node >= 22, `NodeNext`, `ES2024`). Every workspace extends it.
- `test/base.test.ts` guards the base against silent loosening. Change the test only when you deliberately
  change the contract, and say why in the commit message.
- Keep `types: ["node"]`. TS 6 defaults `types` to `[]`, so removing it breaks `node:*` imports everywhere.
- `exactOptionalPropertyTypes` is off on purpose (friction with Playwright and Zod option types).
  Revisit in spec 02.
- TypeScript is pinned to `~6.0.x` in the root `pnpm-workspace.yaml` catalog, because that is the
  `typescript-eslint` peer range.
- Any workspace may list it, but only as a `workspace:*` **devDependency** — never in `dependencies`
  (boundary check BND009, run by `pnpm lint` / `pnpm boundaries`). It depends on no architecture package.

## Never

- Never add `baseUrl` or `paths`. Both are deprecated in TS 6. Workspaces resolve each other through pnpm
  `workspace:*` dependencies and package `exports`.
- Never loosen `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` or `NodeNext` resolution here.
  If one package really needs an exception, override it in that package's `tsconfig.json` and justify it.
- Never add `include`, `files`, `outDir` or `rootDir` to the base. Those belong to each package.
- Never add a build or typecheck script. The package only exposes `*.json` and runs `test`.

## Layout

```
base.json          the strict ESM base (exported as ./base.json)
test/base.test.ts  guards the key options of base.json
vitest.config.ts   test/**/*.test.ts, node env
```

## Commands

```bash
pnpm --filter @idp/typescript-config test
```

Dev tools (`vitest`, `@types/node`) are `catalog:` devDependencies (versions in the root
`pnpm-workspace.yaml`). Lint and format are root-only (`pnpm lint`, `pnpm format:check`).
