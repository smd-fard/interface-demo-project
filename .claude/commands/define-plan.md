---
description: Generate a detailed, file-by-file implementation plan from the current feature spec
argument-hint: (none — reads spec from current branch)
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(git branch:*)
model: opus
---

# Generate Implementation Plan

Ultrathink through the current feature spec and produce a thorough, technically detailed plan that the
`implement-plan` skill can execute without asking questions. Follow every CLAUDE.md rule.

## Step 1. Locate the spec

- `git branch --show-current`. On `main`, abort: "Switch to the feature branch first."
- `feature_slug` = the branch name without `feature/`. `_design/<slug>/spec.md` must exist; if it does not,
  list the specs and ask.
- If the spec has unresolved **Open Questions** that change the build, list them and stop. Planning around
  an unknown creates rework.
- If `plan.md` exists, ask before overwriting.

## Step 2. Gather context (read selectively)

1. `spec.md`: the source of truth for what to build.
2. The root `CLAUDE.md`: workspace map, **dependency direction**, **Hard invariants**.
3. The `CLAUDE.md` of each package the spec names, and the code already in those packages.
4. The ADRs linked from the spec, plus `docs/adr/README.md`.
5. The skills in `.claude/skills/*/SKILL.md` whose generators this plan will use. **Steps must be phrased so
   they map to a skill** (see `implement-plan`'s mapping table).
6. `_design/index.md`, for what has shipped.

## Step 3. Ultrathink the plan

**Build order.** Follow the dependency direction, and put each step in a phase:

| Phase | Layer                                     | Typical skills                                   |
| ----- | ----------------------------------------- | ------------------------------------------------ |
| 1     | Package scaffolds                         | `scaffold-package`                               |
| 2     | Contracts (`artifact-schema`)             | `define-schema`                                  |
| 3     | Pure core (`policy`, `evidence`)          | TDD, `define-action` (policy side)               |
| 4     | Surface + target (`surface`, `mock-bank`) | `define-mock-screen`, `define-action` (surface side) |
| 5     | Engines (`session`, `replay-engine`, `agent`) | `define-runtime-condition`, `define-action` (tool/handler side) |
| 6     | Apps (`cli`, `operator`)                  | TDD                                              |
| 7     | Docs, ADRs, evidence hooks                | `update-docs`, `/define-adr`                     |

Skip the phases the spec does not touch.

**File-by-file detail.** For every significant file: its path, its purpose, its key exports (types, schemas,
classes, methods, union members, error codes), and any non-obvious decision. Err on the side of more detail.

**Invariant check.** For each invariant in the root `CLAUDE.md`, say in one line how the plan honours it,
or "not touched". A plan that adds an action type without policy + surface + replay + agent coverage is
incomplete.

**Contract impact.** If `artifact-schema` changes: the semver bump, the fixture updates, the JSON Schema regen,
and every consumer to update.

**Tests.** Name the Vitest files and what each covers: unit tests next to the source; functional tests in
`<pkg>/test/functional/` driving real Playwright against `mock-bank` started as a process; agent tests with a
**scripted fake model** (never a real LLM). Every runtime condition gets an injected-fault test that asserts
the exact `RunResult` variant.

**Evidence.** Which `evidence/` files the spec's ACs need, and which command produces them.

**Risks.** Specific seams, flakiness sources (waits, frames, timing), and spec ambiguities, naming the files.

## Step 4. Write `_design/<slug>/plan.md`

Use exactly this structure. Every section is required. Prose and file paths only, no code snippets.

```
# Implementation Plan — <Title>

> Source spec: `./spec.md` (branch `feature/<slug>`, PoC: <PoC>, requirements: <IDs>).

## Context
[2–4 sentences.]

## Approach
[3–6 sentences: build order rationale, key decisions (link ADRs), what is deferred.]

## Implementation steps

### 1. <Phase N — layer: action, e.g. "Phase 2 — artifact-schema: define CapabilityArtifact v1">
Skill: <skill name | TDD | glue>
Create / Modify:
- `path/to/file.ts` — purpose; key exports.

### 2. ...

## Invariant check
- No LLM on replay path — ...
- Every action through policy — ...
- Redact before any sink — ...
- Business outcome ≠ failure — ...
- Checkpoints — ...
- Schema is a public contract — ...
- Synthetic data only — ...

## Critical files
**To create**
- ...
**To modify**
- `path` (what changes and why)

## Test plan
- `path/to/X.test.ts` — what it covers.

## Verification
1. `pnpm install`
2. `pnpm build`
3. `pnpm test`
4. <smoke: exact CLI command(s) and the expected result>

## Evidence
- <files under evidence/ and the command that produces them, or "n/a">

## Open items the spec already calls out (no plan change needed)
- ...

## Risks / things to watch during execution
- ...
```

## Step 5. Output

Set the `Plan` cell in `_design/index.md` to `[plan](./<slug>/plan.md)` and Status to `Planned`. Respond with exactly:

```
Plan file: _design/<slug>/plan.md
Title: <title>
Sections: Context | Approach | <N> steps in phases <list> | Invariant check | Critical files | Test plan | Verification | Evidence | Open items | Risks
Next: /define-design (LLD), then implement-plan <slug>
```
