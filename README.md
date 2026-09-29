# interface-demo-project

A computer-use automation system for legacy bank back-office apps that have no API. An LLM **discovers**
how to accomplish a goal on a live UI. The successful run becomes a typed, versioned **capability artifact**,
and that artifact is **replayed deterministically**, without the model, whenever an AI agent invokes it.
When the system gets stuck, a human takes over the same live session and hands it back.

> **Status: in progress.** The work is spec-driven. See [`_design/roadmap.md`](_design/roadmap.md) and
> [`_design/index.md`](_design/index.md). The sections below are filled as each spec ships.

- Design write-up: [`REPORT.md`](REPORT.md)
- Evidence of real runs: [`evidence/`](evidence/README.md)
- Requirements traceability: [`docs/requirements.md`](docs/requirements.md) · Decisions: [`docs/adr/`](docs/adr/README.md)

## Setup

Requires Node ≥ 22.13 (`.nvmrc` pins major 22; `.npmrc` sets `engine-strict=true`) and pnpm via Corepack
(the version comes from `packageManager` in `package.json`).

```bash
nvm use                # Node 22 from .nvmrc
corepack enable        # provides the pinned pnpm
pnpm install
pnpm build             # turbo run build
pnpm test              # unit + functional tests (no API key, no browser, no network)
pnpm lint              # ESLint + dependency-boundary checks (pnpm boundaries)
pnpm format:check      # Prettier
```

Other root scripts: `pnpm typecheck`, `pnpm format`, `pnpm boundaries`, `pnpm clean`.

_Planned (`web-surface`): `pnpm exec playwright install chromium` becomes a setup step once the Playwright
surface ships. It is not needed today._

### Configuration

```bash
cp .env.example .env   # gitignored; never commit real values
```

Only discovery needs `ANTHROPIC_API_KEY`; replay and the tests never use it. `CONTEXT7_API_KEY` is optional
(developer-docs MCP server only).

### Running without live services

The test suite (`pnpm test`) needs no API key, no browser and no network. _Planned: the target app
(`apps/mock-bank`) will run locally via `pnpm mock-bank`, added by its spec; replay will run against it
without an API key._

## Demo path

_TBD (`cli-demo-path`): the exact commands to (1) start the target, (2) run discovery on a goal, and
(3) replay the resulting artifact with params, including a not-found case and an injected failure._

## Repository layout

See [`CLAUDE.md`](CLAUDE.md) § Workspace map.
