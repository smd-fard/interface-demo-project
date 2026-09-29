# @idp/mock-bank

A deliberately hostile legacy core-banking web app (synthetic data, fault switches) used as the proxy target.

## Exports

None yet. `src/index.ts` is `export {};` — the public API is **planned** and lands with spec
03 `mock-bank-target` (see [`_design/roadmap.md`](../../_design/roadmap.md)).

## Run

```bash
pnpm --filter @idp/mock-bank build && pnpm --filter @idp/mock-bank start   # node dist/index.js
pnpm --filter @idp/mock-bank dev                                          # tsx watch src/index.ts
```

The entry point is currently empty: `start` exits immediately and `dev` only watches for changes.

## Configuration

No environment variables or ports yet — planned with spec 03 `mock-bank-target`.
