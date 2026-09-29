# @idp/cli

The `idp` command-line app for the demo path: `discover`, `replay`, `catalog` and `operator`.

## Exports

None yet. `src/index.ts` is `export {};` — the public API is **planned** and lands with spec
10 `cli-demo-path` (see [`_design/roadmap.md`](../../_design/roadmap.md)).

## Run

```bash
pnpm --filter @idp/cli build && pnpm --filter @idp/cli start   # node dist/index.js
pnpm --filter @idp/cli dev                                          # tsx watch src/index.ts
```

The entry point is currently empty: `start` exits immediately and `dev` only watches for changes.
The `idp` bin maps to `dist/index.js`; the root `pnpm idp <command>` script is planned.

## Configuration

No environment variables or ports yet — planned with spec 10 `cli-demo-path`.
