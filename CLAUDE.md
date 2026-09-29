# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A take-home project for interface.ai: a **computer-use automation system** for legacy bank back-office
apps that have no API. The requirements are in [`docs/requirements.md`](docs/requirements.md) (IDs
`R*`/`D*`/`S*`). The through-line every change must serve:

> **The model discovers. The artifact becomes a reusable capability. Deterministic replay is how the
> AI agent invokes it in production.**

1. **Discover** — an LLM drives a live UI (observe → decide → act) until a natural-language goal is met.
2. **Compile** — the successful run becomes a typed, versioned **capability artifact** (steps, locators,
   typed inputs/outputs, checkpoints, outcome rules). It is separate from the model transcript.
3. **Replay** — the artifact runs deterministically with **no LLM in the decision loop**. It returns
   `success | business_outcome | failure`.
4. **Escalate** — when stuck, it pauses, raises an intervention request, hands the **same live session**
   to a human, records their actions, and resumes.
5. **Guard** — every action passes the policy (allowlist + risk class). Sensitive data is redacted
   before it reaches any sink.

## Tech stack (decided — see [ADR-0001](docs/adr/0001-stack-and-workspace-layout.md) and `docs/adr/`)

TypeScript (strict, ESM) on Node ≥ 22 · pnpm workspaces + Turborepo · Zod (contracts + JSON Schema
export) · Playwright (web surface; the accessibility tree is the primary perception) · Anthropic SDK
(Claude, tool calling) · pino (structured logs) · Vitest (unit + functional) · ESLint (typescript-eslint) +
Prettier. TypeScript is pinned to 6.0.x (the typescript-eslint peer range). Shared dependency versions live in
the pnpm `catalog:` in `pnpm-workspace.yaml`. There is no database: artifacts, policy and evidence are files.

## Workspace map

Package scope is `@idp/*`. **Status: scaffolded, shells empty until their spec.** Every workspace below
exists (created by `monorepo-foundation`) and builds, typechecks and tests, but apart from
`typescript-config` and `tools/repo-checks` each is an empty shell. What a package "Owns" is its intended
responsibility; it is real only once its spec in [`_design/roadmap.md`](_design/roadmap.md) ships
(status in [`_design/index.md`](_design/index.md)).

| Path                          | Package                 | Owns                                                                                                                                                              |
| ----------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/typescript-config`  | `@idp/typescript-config` | Shared `tsconfig` bases.                                                                                                                                          |
| `packages/artifact-schema`    | `@idp/artifact-schema`  | **The contracts.** Zod schemas + types for the capability artifact, locators, steps, params/outputs, checkpoints, outcome rules, and the replay **result contract**. JSON Schema export. Runtime dep: `zod` only. |
| `packages/policy`             | `@idp/policy`           | Allowlist (domains/routes/action types), action risk classes, redaction rules. Pure functions, no I/O.                                                           |
| `packages/evidence`           | `@idp/evidence`         | Redacting structured run log, evidence store (screenshots, a11y snapshots, traces), run manifests.                                                               |
| `packages/surface`            | `@idp/surface`          | The **`Surface` port** (`observe` / `act` / `resolve`) + the Playwright web adapter, the locator-ladder resolver, and the human-action recorder.                   |
| `packages/session`            | `@idp/session`          | Live session controller: control lease (`AGENT` / `PAUSED` / `HUMAN` / `RESUMING`), intervention requests, pause/cede/resume.                                     |
| `packages/replay-engine`      | `@idp/replay-engine`    | Deterministic executor: waits, checkpoints, runtime-condition detection, bounded recovery, result classification.                                                  |
| `packages/agent`              | `@idp/agent`            | LLM discovery loop (tools ⇄ `Surface`) + the **artifact compiler** (successful run → capability artifact).                                                        |
| `apps/cli`                    | `@idp/cli`              | `discover`, `replay`, `catalog`, `operator` commands — the demo path.                                                                                            |
| `apps/operator`               | `@idp/operator`         | Minimal (deliberately mocked) operator console: list interventions, take control, resume.                                                                         |
| `apps/mock-bank`              | `@idp/mock-bank`        | The **proxy target**: a hostile legacy core-banking web app (framesets, nested tables, no test IDs) with fault-injection switches and a tenant variant. Synthetic data only. |
| `tools/repo-checks`           | `@idp/repo-checks`      | Tooling. Dependency-boundary checks (BND001–BND009) from `layers.json`; runs in `pnpm lint`. Not part of the dependency direction below. |

### Dependency direction (enforced)

```
artifact-schema ← policy ← evidence ← surface ← session ← { replay-engine, agent } ← { cli, operator }
```

Enforced by [`tools/repo-checks/layers.json`](tools/repo-checks/layers.json) (the machine-readable form of
this diagram) through `pnpm boundaries` (run by `pnpm lint`) and ESLint `no-restricted-imports`. The diagram
and `layers.json` must change together.

- Packages import only from packages to their **left**. There are no cycles.
- **`apps/mock-bank` imports nothing from `packages/*`, and nothing imports it.** The system treats the
  target as a black box, reachable only over HTTP through a `Surface`. Tests start it as a process.
- Only `@idp/surface` imports Playwright. Every other package sees the `Surface` port. This is the seam
  for legacy-web and desktop surfaces (R7.1).
- Only `@idp/agent` imports the Anthropic SDK. `@idp/replay-engine` must never depend on `@idp/agent`,
  directly or transitively (R3.1).

## Hard invariants (never break these; flag any spec or plan that would)

1. **No LLM on the replay path.** Replay is deterministic. Any optional assisted-fallback (stretch goal S4)
   lives behind an explicit, policy-checked, single-step seam and is recorded as evidence.
2. **Every action goes through policy.** Every agent tool call, replay step and human-recorded action maps
   to one registered **action type**, which has a risk class and an allowlist check. There is no raw
   `page.click` outside `@idp/surface`, and no action type without a policy entry.
3. **Redact before any sink.** Logs, artifacts, evidence, intervention requests and LLM prompts receive
   data only after it passes through the redaction layer. Artifacts store **parameter references**
   (`{{memberId}}`), never the concrete sensitive values used during discovery.
4. **A business outcome is not a failure.** Results use a discriminated union:
   `success` (outputs) | `business_outcome` (e.g. `member_not_found`) | `failure` (step, expected,
   observed, evidence refs). Recoverable conditions are handled inside the run and logged. They are never
   returned as outcomes.
5. **Checkpoints, not assumptions.** Every step that changes the screen is followed by a verifiable
   checkpoint. "The click didn't throw" is not success.
6. **The artifact schema is a public contract.** Any change bumps `schemaVersion` (semver) and updates the
   JSON Schema export, fixtures and tests (skill `define-schema`).
7. **Synthetic data only.** Never use real PII, real credentials, or real bank or public sites without
   explicit user approval. Secrets live in `.env` (gitignored). Never commit them, and never echo them.

## Conventions

- **Contracts:** Zod schema + `z.infer` type side by side, named `<Thing>Schema` / `<Thing>`. Discriminated
  unions carry a `kind` tag. Contracts live in `@idp/artifact-schema` unless they are private to one package.
- **Errors:** typed error classes with a stable `code`. Never throw strings. Never use `catch {}` to swallow.
- **Files:** one exported concept per file, `PascalCase.ts` for classes, `camelCase.ts` for function
  modules, a barrel `src/index.ts` per package. Tests sit next to the source (`*.test.ts`). Functional
  tests go in `<pkg>/test/functional/`.
- **Tests never call a real LLM.** Agent tests use a scripted fake model. The only real model calls happen
  in `/capture-evidence` discovery runs, and those need user confirmation because they cost money.
- **Docs:** each package has a `CLAUDE.md` (its rules) and a `README.md` (its API). Decisions go in ADRs
  under `docs/adr/`. `REPORT.md` summarizes the ADRs under the **seven exact headings** the assignment
  requires.
- Use Context7 for library/API documentation (Playwright, Zod, Anthropic SDK, Turborepo) without being asked.

## Spec-driven workflow (SDD)

Nothing is built without a spec. The planned feature sequence is in [`_design/roadmap.md`](_design/roadmap.md)
and the status of each feature is in [`_design/index.md`](_design/index.md).

```
/define-spec <idea>      → branch feature/<slug> + _design/<slug>/spec.md   (cites requirement IDs)
/define-design           → _design/<slug>/README.md  (HLD: Before → After, ≤ 80 lines)
/define-adr <decision>   → docs/adr/NNNN-*.md        (whenever a spec/plan makes a defendable choice)
/define-plan             → _design/<slug>/plan.md    (file-by-file, build order, tests)
/define-design           → appends the LLD to the README
implement-plan <slug>    → skill: subagents run the per-layer skills with build/test gates
/safety-review           → audit the diff against invariants 1–3 and 7
/commit                  → test-gated commit; then merge feature/<slug> → main locally (--no-ff)
```

Cross-cutting commands: `/trace-requirements` (the coverage matrix of R*/D* → spec → code → test → evidence),
`/capture-evidence` (real discovery + replay runs into `evidence/`), and `/update-report` (sync `REPORT.md`).

Generator skills (used by `implement-plan`, or directly): `scaffold-package`, `define-schema`, `define-action`,
`define-runtime-condition`, `define-mock-screen`, `write-unit-test`, `write-functional-test`, `update-docs`.

## Commands

Root scripts (from the root `package.json`). Node ≥ 22.13 (`.nvmrc`, `engine-strict`); pnpm comes from
`packageManager` via Corepack.

```bash
pnpm install
pnpm build          # turbo run build (tsc -b tsconfig.build.json per workspace)
pnpm typecheck      # turbo run typecheck
pnpm lint           # eslint . && pnpm boundaries
pnpm test           # turbo run test — unit + functional, no real LLM, no browser, no network
pnpm format         # prettier --write .
pnpm format:check   # prettier --check .
pnpm boundaries     # @idp/repo-checks: dependency-boundary checks against layers.json
pnpm clean          # turbo run clean + remove .turbo
```

Added by their specs (not yet available): `pnpm mock-bank` (start the proxy target app) and
`pnpm idp <command>` (the CLI: `discover | replay | catalog | operator`).

Git: `origin` is the GitHub repo. Feature branches `feature/<slug>` branch from and merge back into `main`
locally. Claude never pushes (`git push` is denied in `.claude/settings.json`); the user pushes.
