# @idp/agent — CLAUDE.md

> Workspace: `packages/agent` · Root rules: [../../CLAUDE.md](../../CLAUDE.md)

## Purpose

The discovery side of the system (R1, R2). It owns the LLM discovery loop — observe → decide → act,
with model tools wired to the `Surface` port — that drives a live UI until a natural-language goal is
met, and the **artifact compiler** that turns a successful run into a typed, versioned capability
artifact, separate from the model transcript. It is the only package that may import the Anthropic
SDK.

Status: implemented (plan steps 45–48, 55 of `computer-use-automation-system`). The API is in
[README.md](README.md).

## Owns

- The LLM discovery loop: model tool definitions ⇄ `Surface` (`observe` / `act` / `resolve`).
- The artifact compiler: successful run → capability artifact (steps, locators, typed params/outputs,
  checkpoints, outcome rules), validated against `@idp/artifact-schema`.
- The model-client port (`ModelClient`), the real adapter (`AnthropicModelClient`) and the scripted fake
  (`ScriptedModel`, scripts in `scripts/*.script.json`) used by tests and keyless discovery.
- The agent tools — one per action kind (define-action touch point 5: `src/tools/toolDefinitions.ts`) plus the
  control tools — and the placeholderized observation and system prompt the model sees.
- `DiscoveryRunner`: session → loop → compile (on `goal_met` only) → `artifact.json` / `result.json`.

## Never

- Never imports `@idp/replay-engine` (it is a peer) or any app (incl. `apps/mock-bank`); replay never depends
  on this package either (invariant 1).
- Never depends on `playwright` directly (only via the `Surface` port).
- Never issues an agent tool call that does not map to a registered action type and pass policy.
- Never sends unredacted data to an LLM prompt: goal, observations and tool results pass through
  `redactor.placeholderize` first, and the model only ever types `{{param}}` / `{{credential.*}}` placeholders.
- Never compiles concrete values into an artifact — only parameter references (`{{memberId}}`);
  `assertNoConcreteValues` is the last guard before `artifact.json` is written. Its redaction-rule scan skips
  only structural fields and the declared `example` of a `sensitive: false` param; a literal amount in a step fails.
- Never adds an action tool without an action kind: `ACTION_TOOLS` `satisfies Record<ActionKind, …>`.
- Never calls a real LLM from tests — use a scripted fake model.

## Allowed dependencies

- `@idp/artifact-schema`, `@idp/policy`, `@idp/evidence`, `@idp/surface`, `@idp/session`.
- Third-party runtime: `@anthropic-ai/sdk` (only this package may) and `zod` (tool input and script schemas).
- Dev tools (`typescript`, `vitest`, `rimraf`, `@types/node`) are `catalog:` devDependencies;
  versions live in the root `pnpm-workspace.yaml`. `@idp/typescript-config` is a `workspace:*` devDependency.

## Enforcement

The dependency direction is enforced by `pnpm lint`: ESLint `no-restricted-imports` generated from
`tools/repo-checks/layers.json` (source imports) plus `pnpm boundaries` (manifest check, BND001–BND009).
Codes most relevant here:

- BND001 — may depend only on layers to its left; `@idp/replay-engine` is the same rank (a peer), so it
  is forbidden.
- BND005 — this package **owns** `@anthropic-ai/sdk`; no other workspace may list it.
- BND004 (`playwright` is owned by `@idp/surface`).

## Layout

```
src/
  index.ts           barrel
  model/             ModelClient port + message types, AnthropicModelClient (the only SDK importer),
                     ScriptedModel + ModelScript schema (scripts/*.script.json)
  tools/             one tool per action kind + declare_output/finish/request_help; toolToAction
                     (placeholder + credential resolution → SurfaceAction)
  observe/           formatObservation (placeholderized a11y text) + parseFormattedObservation
  prompt/            buildSystemPrompt
  loop/              DiscoveryLoop (observe → model → guarded act → TraceStep), StopConditions, DiscoveryOutcome,
                     DiscoverySession (the LiveSession port the loop needs)
  trace/             DiscoveryTrace types, ScreenDiff + computeScreenDiff, safeFingerprint (placeholderized)
  compiler/          ArtifactCompiler, buildLocatorLadder, deriveCheckpoint, assertNoConcreteValues, TextGuard;
                     fixtures/member-lookup.trace.json (a recorded, placeholderized trace)
  DiscoveryRunner.ts session → loop → compile on goal_met only → artifact.json / result.json / manifest
  errors/            MissingApiKeyError, ModelCallError, ScriptError, ToolCallError, DiscoveryConfigError,
                     ArtifactCompileError, UncheckpointableStepError, UnlocatableTargetError, ConcreteValueLeakError,
                     UnparameterizedSensitiveValueError
scripts/             member-lookup / open-sub-account model scripts (placeholders only)
test/functional/     discoverMemberLookup, discoveryStops (ScriptedModel against mock-bank, started through
                     `launchMockBank` from `@idp/surface/testing`); discoveryHarness.ts has the synthetic values
tsconfig.json                noEmit; typecheck + editor, includes src, test/ and both vitest configs
tsconfig.build.json          emits src → dist (excludes *.test.ts and fixtures/)
vitest.config.ts             unit tests: src/**/*.test.ts (no browser, no network, no real model)
vitest.functional.config.ts  functional: test/functional/**/*.test.ts, no file parallelism, 60 s timeouts
```

## Exemplars

- A tool: its zod schema in `src/tools/toolInputSchemas.ts`, its entry in `src/tools/toolDefinitions.ts`, its
  case in `src/tools/toolToAction.ts`, a case in `toolToAction.test.ts`.
- A model script: `scripts/member-lookup.script.json` (targets by role + label/name + frame, placeholders only).
- A unit test with fakes: `src/loop/DiscoveryLoop.test.ts` (scripted model, fake session, no browser).
- A compiler test from a recorded trace: `src/compiler/ArtifactCompiler.test.ts` + `fixtures/member-lookup.trace.json`.

## Commands

```bash
pnpm --filter @idp/agent build
pnpm --filter @idp/agent typecheck
pnpm --filter @idp/agent test
pnpm --filter @idp/agent test:functional   # starts mock-bank + a headless browser (build mock-bank first)
```

Lint and format are root-only (`pnpm lint`, `pnpm format:check`); there is no per-package lint script.
