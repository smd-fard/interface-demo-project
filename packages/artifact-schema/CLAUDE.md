# @idp/artifact-schema — CLAUDE.md

> Workspace: `packages/artifact-schema` · Root rules: [../../CLAUDE.md](../../CLAUDE.md)

## Purpose

**The contracts.** Zod schemas and inferred types for the capability artifact (steps, locator ladders, frame
scopes, typed params/outputs, checkpoints, outcome rules, provenance, content hash), the app profile, the
replay **result contract** (`success | business_outcome | failure`), the control state and intervention
request, the evidence contracts (evidence refs, run log, run manifest) and the policy config — plus their
JSON Schema export. It is the leftmost layer: every other package builds on these contracts. Serves R2.1–R2.7,
R3.4/R3.5 (result contract), R4.1/R4.3 (policy config, no raw secrets), R6.1 (intervention request), R7.1
(surface-neutral contract) and invariant 6 (the artifact schema is a public contract).

**Status:** implemented — public contract `SCHEMA_VERSION = '1.0.0'` (see [CHANGELOG.md](CHANGELOG.md)).

## Owns

- Zod schemas + `z.infer` types (`<Thing>Schema` / `<Thing>`), one concept per file; every field has a
  `.describe()` (it ships in the JSON Schema, R2.7). Persisted documents are strict objects.
- The closed list of action kinds, `ACTION_KINDS` in `src/step/ActionKind.ts` — **`define-action` touch
  point 1** (a new kind also adds its `<Kind>StepSchema` member to the `Step` union in `src/step/Step.ts`).
- Cross-field refinements (declared params/outputs/placeholders, unique ids, checkpoint after every
  screen-changing step, no literal value in a sensitive fill, credential refs match) — Zod only; the JSON
  Schema describes the shape.
- The `RunResult` union and the closed `FAILURE_REASONS` enum (no member for a recoverable condition).
- The content hash (`canonicalize`, `computeContentHash`) and runtime param/output schemas
  (`paramsSchemaFor`, `outputsSchemaFor`, `valueSchemaFor`).
- `schemas/*.schema.json` (generated, committed) and the golden `fixtures/`.

## Never

- Never add a runtime dependency other than `zod` (boundary check BND007), and no Node-only or Playwright
  types in a contract (R7.1).
- Never import any other `@idp/*` package — this is the leftmost layer.
- Never change a contract without bumping `SCHEMA_VERSION` (semver, `src/version.ts`), running
  `schemas:export`, updating fixtures and tests and adding a `CHANGELOG.md` entry (skill `define-schema`).
  Even a `.describe()` text change is a patch bump and fails the drift test until re-exported.
- Never store concrete sensitive values in artifacts — only parameter references (`{{memberId}}`,
  `{ kind: 'param' }`) and credential refs (`{ kind: 'credential', ref }`).
- Never let a test rewrite fixture hashes: `fixtures:hash` is a manual script.

## Allowed dependencies

- `@idp/*`: none (leftmost layer).
- Third-party runtime: `zod` only.
- Dev: `typescript`, `vitest`, `rimraf`, `@types/node`, `tsx` (scripts), `prettier` (schema export
  formatting) as `catalog:` devDependencies; `@idp/typescript-config` is `workspace:*`.

## Enforcement

`pnpm lint` runs ESLint `no-restricted-imports` generated from `tools/repo-checks/layers.json` plus
`pnpm boundaries` (BND001–BND009). Here: BND001 (no `@idp/*` dependency), BND007 (runtime deps: `zod` only).
`src/jsonSchema.test.ts` is the **drift test**: the generated JSON Schema must equal the committed files.

## Layout

```
src/
  index.ts                 barrel (the whole public API)
  version.ts               SCHEMA_VERSION + SchemaVersionSchema
  jsonSchema.ts            JSON_SCHEMAS registry + toJsonSchemas(); jsonSchema.test.ts = drift test
  common/                  ids, Semver, RiskClass (+ maxRisk), ValueType, TemplateString, ValueExpr,
                           TimeoutMs, Route, Origin, Actor, contentHash, isValidRegExp, errors
  locator/                 FrameScope, LocatorRung(+Kind), TargetRef — the locator ladder (R2.3)
  checkpoint/              Checkpoint(+Kind)
  io/                      ParamSpec, OutputSpec, value/params/outputsSchemaFor, DuplicateSpecNameError
  step/                    ActionKind (ACTION_KINDS, SCREEN_CHANGING_KINDS), StepBase, Step union
  outcome/                 ConditionSignature, ConditionClass, Recovery, OutcomeRule
  profile/                 KnownDialog, AppProfile
  artifact/                CapabilityArtifact (+ cross-field refinements)
  result/                  RunResult(+Kind), FailureReason, ArtifactRef
  control/                 LeaseState/LeaseTransition, InterventionRequest
  evidence/                EvidenceRef, RunLogEntry, RunManifest
  policy/                  PolicyConfig
schemas/<name>.schema.json generated (draft 2020-12, input shapes); exported as `@idp/artifact-schema/schemas/*`
fixtures/                  member-lookup + open-sub-account artifacts, invalid/*.json (one defect each),
                           README.md (fixture table + the mock-bank screen contract the fixtures replay on)
scripts/                   export-json-schema.ts (schemas:export), hash-fixtures.ts (fixtures:hash)
CHANGELOG.md               one entry per SCHEMA_VERSION, with a migration note
```

Every `src/**/X.ts` with logic has an `X.test.ts` beside it.

## Exemplars (copy their shape)

- **`define-schema`:** `src/result/RunResult.ts` + `RunResult.test.ts` (a discriminated union on `kind`,
  strict objects, described fields); `src/io/ParamSpec.ts` (a small strict object);
  `src/artifact/CapabilityArtifact.ts` + its test (cross-field `superRefine`, fixture-driven valid/invalid
  cases with the `EXPECTED_PATH` table).
- **`define-action` touch point 1:** `src/step/ActionKind.ts` (add the kind; add it to
  `SCREEN_CHANGING_KINDS` if it changes the screen) and the `ClickStepSchema` member in `src/step/Step.ts`
  (+ `Step.test.ts`). The kind then needs its `ACTION_REGISTRY` entry in `@idp/policy` or policy fails to
  compile.

## Commands

```bash
pnpm --filter @idp/artifact-schema build
pnpm --filter @idp/artifact-schema typecheck
pnpm --filter @idp/artifact-schema test
pnpm --filter @idp/artifact-schema schemas:export   # regenerate schemas/*.schema.json after a contract change
pnpm --filter @idp/artifact-schema fixtures:hash    # recompute contentHash of fixtures/*.artifact.json after a hand edit
pnpm exec prettier --write packages/artifact-schema/fixtures
```

Lint and format are root-only (`pnpm lint`, `pnpm format:check`); there is no per-package lint script.
