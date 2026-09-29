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

_TBD (`monorepo-foundation`): Node ≥ 22, pnpm, `pnpm install`, `pnpm exec playwright install chromium`._

### Configuration

_TBD: `.env` from `.env.example` (`ANTHROPIC_API_KEY` is needed for discovery only; replay runs without it)._

### Running without live services

_TBD: replay and the test suite need no API key. The target app (`apps/mock-bank`) runs locally._

## Demo path

_TBD (`cli-demo-path`): the exact commands to (1) start the target, (2) run discovery on a goal, and
(3) replay the resulting artifact with params, including a not-found case and an injected failure._

## Repository layout

See [`CLAUDE.md`](CLAUDE.md) § Workspace map.
