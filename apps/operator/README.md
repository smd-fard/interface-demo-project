# @idp/operator

Minimal (mocked) operator console: list interventions, take control of the live session, resume.

## Exports

None yet. `src/index.ts` is `export {};` — the public API is **planned** and lands with spec
09 `session-handoff` (see [`_design/roadmap.md`](../../_design/roadmap.md)).

## Run

```bash
pnpm --filter @idp/operator build && pnpm --filter @idp/operator start   # node dist/index.js
pnpm --filter @idp/operator dev                                          # tsx watch src/index.ts
```

The entry point is currently empty: `start` exits immediately and `dev` only watches for changes.

## Configuration

No environment variables or ports yet — planned with spec 09 `session-handoff`.
