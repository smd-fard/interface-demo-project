# Implementation Plan — Computer-Use Automation System

> Source spec: `./spec.md` (branch `feature/computer-use-automation-system`, PoC: Mos Fard, requirements:
> R1.1–R1.3, R2.1–R2.7, R3.1–R3.5, R4.1–R4.3, R5.1–R5.2, R6.1–R6.4, R7.1–R7.2, R-REAL, D1–D3).

## Context

`monorepo-foundation` has shipped: eleven buildable shells, strict ESM TypeScript, Vitest, and the BND001–BND009
boundary check fed by `tools/repo-checks/layers.json`. Every `src/index.ts` except `repo-checks` is
`export {}`. `.runs/` is already gitignored, and `evidence/`, `REPORT.md` and `README.md` exist as skeletons.
This plan turns the umbrella spec into working code: the end-to-end thread goal → Claude discovery →
compiled artifact → deterministic replay (with the runtime-condition taxonomy) → approval and handoff on the
same live session → redacted evidence.

## Approach

The build follows the dependency direction, and inside it the roadmap's twist: **replay before discovery**.
Contracts come first (phase 2). The pure policy and evidence core follows (3). Then the hostile `mock-bank`
and the Playwright `Surface` (4). Session, replay and agent come next (5), then the CLI and operator apps
(6), and finally docs, ADRs, the report and evidence (7). Replay is proven against **hand-written fixture
artifacts** before the agent exists, so the most-graded pieces (artifact contract, error taxonomy, checkpoints)
do not depend on an LLM. Discovery then only has to emit something replay already runs.

The eight action kinds are designed once in the `Step` union and then added layer by layer, following the six
`define-action` touch points. Each runtime condition is added end to end with `define-runtime-condition`.

Five plan-level decisions extend the spec. They need ADRs, drafted in step 56. The PoC may run `/define-adr` for
them before `implement-plan`:

- **App profiles.** Per vendor app, a reviewed JSON file of condition signatures, login route and known dialogs.
  The compiler copies the relevant rules into each artifact, so the artifact stays self-contained.
- **Mediated human control.** During a handoff, the human's clicks and submits are intercepted in the page,
  policy-checked in Node, then executed and recorded. This is how a human action can be "refused and recorded
  as refused".
- **A localhost control API** on the session. It lets the separate operator process list interventions,
  approve, take control and resume.
- **Placeholders instead of values in prompts.** Sensitive example inputs never reach the model. It sees and
  types `{{memberId}}`, and the surface substitutes the real value.
- **A test split.** `pnpm test` stays browser-free. A new `pnpm test:functional` runs Playwright against a
  local `mock-bank`.

Deferred: all stretch goals (S1–S6), a desktop surface, the multi-tenant override *mechanism* (only schema
room plus a tenant-B drift test), and committed Playwright traces (see Risks: traces cannot be redacted).

## Implementation steps

### 1. Phase 1 — root: dependencies, scripts, turbo tasks, test split

Skill: glue

Create / Modify:

- `pnpm-workspace.yaml`: add to `catalog`: `zod` ^4.6.5, `playwright` ^1.63.0, `@anthropic-ai/sdk` ^0.129.0,
  `pino` ^10.3.1. Before pinning, confirm each is the latest stable version with `pnpm view`.
- `package.json` (root): add these scripts:
  - `test:functional` (`turbo run test:functional`)
  - `mock-bank` (`pnpm --filter @idp/mock-bank start`)
  - `idp` (`pnpm --filter @idp/cli start --`)
  - `operator` (`pnpm --filter @idp/operator start`)
  - `setup:browsers` (`pnpm --filter @idp/surface exec playwright install chromium`)
- `turbo.json`: add the task `test:functional`, with `dependsOn` `^build`, `build` and `@idp/mock-bank#build`,
  and `cache: false`. It starts processes and browsers, so a cached pass proves nothing.
- Every package with functional tests (`surface`, `session`, `replay-engine`, `agent`, `cli`, `operator`,
  `mock-bank`):
  - add the script `test:functional` = `vitest run --config vitest.functional.config.ts`;
  - narrow `vitest.config.ts` `include` to `src/**/*.test.ts`;
  - create `vitest.functional.config.ts` with `test/functional/**/*.test.ts`, `fileParallelism: false`,
    `testTimeout: 60_000` and `hookTimeout: 90_000`.
- Dependencies, each as `catalog:`:
  - `packages/artifact-schema/package.json`: runtime `zod`.
  - `packages/policy/package.json`: nothing new. The policy config schema lives in `artifact-schema`.
  - `packages/evidence/package.json`: runtime `pino`.
  - `packages/surface/package.json`: runtime `playwright`.
  - `packages/agent/package.json`: runtime `@anthropic-ai/sdk`.
  - `apps/cli/package.json`: add `@idp/policy` and `@idp/evidence` as `workspace:*`. Both are left of `cli`, so
    BND001 allows them; update `apps/cli/CLAUDE.md` "Allowed dependencies" to match. Add a `bin` entry
    `idp` → `dist/main.js`.
  - `packages/replay-engine/package.json`: devDependency `@idp/repo-checks` `workspace:*`, for the AC5 test.
    BND009 allows tooling as a devDependency.
- `.env.example`: add empty keys:
  - `IDP_MODEL`: default documented as `claude-sonnet-5-5`.
  - `MOCKBANK_OPERATOR_USER`, `MOCKBANK_OPERATOR_PASSWORD`: synthetic, and documented.
  - `MOCKBANK_PORT`: default 4010.
  - `IDP_CONTROL_PORT`: default 4020.
  - `IDP_OPERATOR_PORT`: default 4030.

### 2. Phase 2 — artifact-schema: primitives

Skill: define-schema

Create:

- `packages/artifact-schema/src/version.ts`: `SCHEMA_VERSION` = `1.0.0`, and `SchemaVersionSchema` (a
  literal).
- `packages/artifact-schema/src/common/Semver.ts`: `SemverSchema` / `Semver`.
- `packages/artifact-schema/src/common/Identifiers.ts`:
  - `CapabilityIdSchema`: kebab slug.
  - `StepIdSchema`: `s<NN>-<slug>`, stable across edits.
  - `ParamNameSchema`: camelCase.
  - `OutcomeCodeSchema`: snake_case.
  - `RunIdSchema`, `InterventionIdSchema`.
- `packages/artifact-schema/src/common/RiskClass.ts`:
  - `RiskClassSchema`: `read | reversible | irreversible`.
  - `RISK_ORDER`, `maxRisk`: pure. `policy` re-exports these.
- `packages/artifact-schema/src/common/ValueType.ts`: `ValueTypeSchema`, a union on `kind` with members:
  - `string` (pattern, minLength, maxLength);
  - `integer` (min, max);
  - `decimal` (scale);
  - `boolean`;
  - `enum` (values);
  - `date` (ISO).

  Params and outputs share this vocabulary.
- `packages/artifact-schema/src/common/ValueExpr.ts`: `ValueExprSchema`, a union on `kind`. It is the only way
  a step carries a value:
  - `param` (name);
  - `literal` (value; refused by a refinement when the step marks the value sensitive);
  - `credential` (ref, field `username | password`).

  `TemplateStringSchema` is for route and label strings containing `{{paramName}}` placeholders. It is
  validated by pattern, and a helper lists the placeholders it uses.
- `packages/artifact-schema/src/common/contentHash.ts`: `canonicalize` sorts keys deterministically.
  `computeContentHash` (async) is sha256 over the canonical artifact with `contentHash` excluded. It uses
  `globalThis.crypto.subtle`: no Node-only types and no new dependency, and it works on a desktop or browser
  host.
- Tests: `packages/artifact-schema/src/common/*.test.ts`.

### 3. Phase 2 — artifact-schema: locators (the ladder)

Skill: define-schema

Create:

- `packages/artifact-schema/src/locator/FrameScope.ts`: `FrameScopeSchema`, an ordered frame path from the top
  document. Each hop is a union on `kind`:
  - `by_name`: the frame `name` attribute. It is stable in legacy framesets.
  - `by_url_path`: a glob.
  - `by_title`.

  The describe text explains why a frame name is preferred.
- `packages/artifact-schema/src/locator/LocatorRung.ts`: `LocatorRungSchema`, a union on `kind`. Every rung has
  a required `rationale` string (R2.3). The rungs are:
  - `role`: role, name (template allowed), exact.
  - `label`: text.
  - `text`: text, match `exact | contains`.
  - `structural`, with a nested `anchor` union:
    - `table_cell_relative`: headerText, direction `right | below`, offset.
    - `form_row`: labelText, control `input | select | button`.
    - `nth_in_container`: last resort, and flagged as brittle in its description.

  A surface-tagged sub-object `surface: { web?: { cssHint? } }` is allowed, but never used by the resolver as a
  primary rung (R7.1). A visual-anchor rung is design-only; it is mentioned in the description, not
  implemented.
- `packages/artifact-schema/src/locator/TargetRef.ts`: `TargetRefSchema` has:
  - `description`: human-readable, e.g. "Search button in the member search form";
  - `frame`: FrameScope;
  - `ladder`: a LocatorRung array, min 1, max 5, in stability order.
- Tests: `LocatorRung.test.ts` (each rung valid; a missing rationale fails; an unknown kind fails),
  `TargetRef.test.ts`.

### 4. Phase 2 — artifact-schema: checkpoints

Skill: define-schema

Create:

- `packages/artifact-schema/src/checkpoint/Checkpoint.ts`: `CheckpointSchema`, a union on `kind`. Members:
  - `element_visible` (target);
  - `element_absent` (target);
  - `text_present` (text, frame?);
  - `text_absent`;
  - `url_matches` (route glob);
  - `title_matches`;
  - `all_of` (checks, depth 1 only, enforced by a refinement).

  Every member has an optional `timeoutMs` override.
- Test: `Checkpoint.test.ts` covers each kind, and nested `all_of` inside `all_of` being rejected.

### 5. Phase 2 — artifact-schema: params and outputs

Skill: define-schema

Create:

- `packages/artifact-schema/src/io/ParamSpec.ts`: `ParamSpecSchema` has:
  - name, description, type (ValueType), required, `sensitive` (default true);
  - `example`, which is forbidden when `sensitive` by a refinement.
- `packages/artifact-schema/src/io/OutputSpec.ts`: `OutputSpecSchema` has name, description, type,
  `sensitive`.
- `packages/artifact-schema/src/io/paramsSchemaFor.ts`: builds a runtime Zod object from a `ParamSpec[]`.
  Replay (FR10), the CLI and the agent all use it.
- `packages/artifact-schema/src/io/outputsSchemaFor.ts`: the same for outputs (FR12).
- Tests: `paramsSchemaFor.test.ts`, `outputsSchemaFor.test.ts` cover types, patterns, required and missing
  values, and an extra key.

### 6. Phase 2 — artifact-schema: the Step union (all eight action kinds)

Skill: define-schema (this is `define-action` touch point 1, done for all kinds at once)

Create:

- `packages/artifact-schema/src/step/StepBase.ts`: the common fields:
  - `id`, `description`, `phase` (`login | main`);
  - `risk`: the class recorded by the compiler. Replay recomputes it and takes the max, never lowering it.
  - `checkpoint`: a Checkpoint, optional in the base.
  - `timeoutMs`.
- `packages/artifact-schema/src/step/Step.ts`: `StepSchema`, a union on `kind`:
  - `navigate`: route as a TemplateString, relative to the artifact's app origin.
  - `click`: target.
  - `fill`: target, value (ValueExpr), `sensitive`.
  - `select`: target, option (ValueExpr).
  - `press`: target (optional), key from an allowlisted enum: `Enter | Tab | Escape`.
  - `extract`: target, output (name), parse union `text | decimal | integer` with an optional pattern.
  - `wait`: until (a Checkpoint), timeoutMs.
  - `dismiss_dialog`: match text pattern, action `accept | dismiss`.

  A `superRefine` requires `checkpoint` on the screen-changing kinds (`navigate`, `click`, `press`, `select`,
  `dismiss_dialog`). This is invariant 5. `ACTION_KINDS` is exported as a const tuple.
- Test: `Step.test.ts` covers:
  - each kind valid;
  - a click without a checkpoint is rejected;
  - a fill with a literal and `sensitive: true` is rejected;
  - an unknown key is rejected (strict).

### 7. Phase 2 — artifact-schema: outcome rules and app profile

Skill: define-schema

Create:

- `packages/artifact-schema/src/outcome/ConditionSignature.ts`: `ConditionSignatureSchema`, a union on `kind`
  that describes how a condition is recognised. Signals are ones a non-DOM surface also has:
  - `text_present` (pattern, frame?);
  - `title_matches`;
  - `route_matches`;
  - `dialog_text` (pattern);
  - `http_status` (range);
  - `any_of`.
- `packages/artifact-schema/src/outcome/OutcomeRule.ts`: `OutcomeRuleSchema` has:
  - `code`;
  - `class` (`business_outcome | recoverable | failure`);
  - `signature`;
  - `scope`: `any_step` or a list of step ids;
  - `message`: an optional TargetRef whose text becomes the redacted message;
  - `recovery`, allowed only when `class` is `recoverable`. A union on `kind`:
    - `dismiss_dialog` (action);
    - `click_through` (target), for an HTML interstitial;
    - `retry` (max, backoffMs);
    - `reauth`.
- `packages/artifact-schema/src/profile/AppProfile.ts`: `AppProfileSchema` has:
  - `app` (vendorApp id, appVersion?);
  - `variant` (tenant id);
  - `origin`, `loginRoute`, `credentialRef`;
  - `conditions`: an array of OutcomeRule, the defaults for this app;
  - `knownDialogs`.

  This is a persisted config contract read by the compiler and replay.
- Tests: `OutcomeRule.test.ts` (recovery on a business outcome is rejected), `AppProfile.test.ts`.

### 8. Phase 2 — artifact-schema: CapabilityArtifact v1.0.0 and fixtures

Skill: define-schema

Create:

- `packages/artifact-schema/src/artifact/CapabilityArtifact.ts`: `CapabilityArtifactSchema`, strict, with:
  - `schemaVersion`, `id`, `version` (Semver), `title`;
  - `summary`: `does`, `needs`, `returns`, written for a reviewer and a calling agent (R2.7);
  - `app`: vendorApp, variant, appVersion?, origin placeholder `{{origin}}`;
  - `extends`: optional `{ baseId, baseVersion }`, room for the S5 base-plus-overrides design (R7.2) that no
    engine reads in v1;
  - `provenance`: discoveryRunId, compiledAt, compilerVersion, model id (id only), `humanStepIds` for steps
    recorded during a handoff;
  - `credentialRef`;
  - `params`, `outputs`;
  - `steps`: min 1;
  - `successCondition`: a Checkpoint;
  - `outcomeRules`;
  - `contentHash`.

  Refinements check that:
  - every `param` ValueExpr and every placeholder names a declared param;
  - every `extract.output` names a declared output, and every output is extracted exactly once;
  - step ids are unique;
  - `outcomeRules[].scope` ids exist.
- `packages/artifact-schema/fixtures/member-lookup.artifact.json`: hand-written, with correct hashes against
  the step-18 `mock-bank` screens. Login (credential ref) → search frame fill `{{memberId}}` → click Search →
  checkpoint on detail heading → extract `savingsBalance` (decimal, sensitive) and `memberName` (sensitive).
  Outcome rules: `member_not_found`, `validation_rejected`, `permission_denied`, the known maintenance
  dialog, and session expiry.
- `packages/artifact-schema/fixtures/open-sub-account.artifact.json`: its final click on "Confirm" has
  `risk: irreversible`.
- `packages/artifact-schema/fixtures/invalid/*.json`: each of these is rejected:
  - a concrete member number in a fill literal;
  - a missing checkpoint;
  - an undeclared param;
  - a wrong `schemaVersion`;
  - a raw password.
- `packages/artifact-schema/scripts/hash-fixtures.ts`: recomputes `contentHash` for the fixtures. It is run by
  the define-schema step, never at test time.
- Tests: `CapabilityArtifact.test.ts` parses every valid fixture, rejects every invalid one with a useful
  path, and verifies that each fixture's `contentHash` matches `computeContentHash`.

### 9. Phase 2 — artifact-schema: RunResult

Skill: define-schema

Create:

- `packages/artifact-schema/src/result/RunResult.ts`: `RunResultSchema`, a union on `kind`:
  - `success`: runId, artifact `{ id, version, contentHash }`, outputs record, durationMs, `drift` (list of
    stepId + matched rung index/kind when the index is above 0), `recoveries` count.
  - `business_outcome`: runId, artifact, code, message (already redacted), stepId.
  - `failure`: runId, artifact (nullable when the artifact itself was invalid), `reason`, `step`
    (`{ index, id }` or null), `expected`, `observed` (strings, redacted), `evidence` (EvidenceRef[]),
    `interventionRequestId` (optional).

  `FailureReasonSchema` is the enum:
  - `invalid_params`, `artifact_invalid`;
  - `policy_denied`, `approval_required`, `approval_rejected`;
  - `target_unresolved`, `checkpoint_failed`, `unknown_dialog`, `app_error`, `recovery_exhausted`;
  - `output_invalid`, `session_lost`, `human_aborted`, `timeout`.

  The enum has no member for a recoverable condition, by construction (invariant 4).
- Test: `RunResult.test.ts`.

### 10. Phase 2 — artifact-schema: InterventionRequest and control state

Skill: define-schema

Create:

- `packages/artifact-schema/src/control/LeaseState.ts`:
  - `LeaseStateSchema`: `AGENT | PAUSED | HUMAN | RESUMING | CLOSED`.
  - `LeaseTransitionSchema`: from, to, actor (`agent | replay | operator:<id>`), reason, at, requestId?.
- `packages/artifact-schema/src/control/InterventionRequest.ts`: `InterventionRequestSchema` has:
  - id, runId, `runKind` (`discovery | replay`);
  - `kind` (`approval | takeover`);
  - `reason` (code + text);
  - `subject`: a capability `{ id, version }` or a goal (redacted);
  - `currentStep`: index, id?, description, risk;
  - `state`: redacted url, title, screenshotRef, a11ySnapshotRef;
  - `options`: the allowed decisions;
  - `status`: `open | claimed | resolved`;
  - `resolution`: decision `approve | reject | resumed | aborted`, by, at.
- Test: `InterventionRequest.test.ts`.

### 11. Phase 2 — artifact-schema: run log, evidence refs, manifest

Skill: define-schema

Create:

- `packages/artifact-schema/src/evidence/EvidenceRef.ts`: `EvidenceRefSchema` has id, kind
  (`screenshot | a11y_snapshot | trace | json | log`), relative path, sha256, `redacted: true` (a literal, so
  an unredacted ref cannot be represented), and `localOnly`.
- `packages/artifact-schema/src/evidence/RunLogEntry.ts`: `RunLogEntrySchema`, a union on `kind`, with the
  entry types `run_started`, `observation` (digest + snapshot ref), `decision` (model reason, tool, input;
  discovery only), `policy_verdict`, `locator_resolved` (stepId, rungIndex, rungKind), `action`,
  `checkpoint`, `condition_detected`, `recovery`, `lease_change`, `intervention`, `human_action`, `result`.
  Every entry also carries seq, at, runId and actor.
- `packages/artifact-schema/src/evidence/RunManifest.ts`: `RunManifestSchema` has runId, kind, started,
  ended, artifact ref, result kind, evidence refs, log path, and `redactionRulesVersion`.
- Test: `RunLogEntry.test.ts`, `RunManifest.test.ts`.

### 12. Phase 2 — artifact-schema: PolicyConfig

Skill: define-schema

Create:

- `packages/artifact-schema/src/policy/PolicyConfig.ts`: `PolicyConfigSchema` has:
  - `version`;
  - `allow.origins`: exact origin strings; `${ENV}` expansion is done by the loader, not the schema;
  - `allow.routes`: globs per origin;
  - `allow.actions`: ActionKind[];
  - `irreversible.controlNamePatterns`: regex strings;
  - `irreversible.routes`;
  - `redaction.patterns`: name, regex, mask style `full | keep_last_2 | keep_last_4`;
  - `redaction.terms`: synthetic names to mask;
  - `approval.expiresMs`.
- Test: `PolicyConfig.test.ts`.

### 13. Phase 2 — artifact-schema: JSON Schema export, barrel and changelog

Skill: define-schema

Create / Modify:

- `packages/artifact-schema/src/jsonSchema.ts`: `JSON_SCHEMAS`, a registry of name → Zod schema, turned into
  JSON Schema with `z.toJSONSchema`. It covers CapabilityArtifact, RunResult, InterventionRequest,
  RunLogEntry, RunManifest, PolicyConfig and AppProfile.
- `packages/artifact-schema/scripts/export-json-schema.ts` writes
  `packages/artifact-schema/schemas/<name>.schema.json`. The package gets the script `schemas:export`.
- `packages/artifact-schema/src/jsonSchema.test.ts`: the drift test. The generated output must equal the
  committed `schemas/*.json`.
- `packages/artifact-schema/src/index.ts`: the barrel.
- `packages/artifact-schema/CHANGELOG.md`: "1.0.0: initial public contract".

### 14. Phase 3 — policy: risk classes and the action registry

Skill: define-action (touch point 2, all eight kinds) + TDD

Create:

- `packages/policy/src/actions/actionRegistry.ts`: `ACTION_REGISTRY`, one entry per `ACTION_KINDS` member with
  `risk`, `allowlistKey` and `payloadRedaction` (`none | value | extracted`).
  - `navigate`: read.
  - `click`: reversible (raisable).
  - `fill`: reversible, value redacted.
  - `select`: reversible.
  - `press`: reversible (raisable, since Enter can submit).
  - `extract`: read, extracted redacted per output sensitivity.
  - `wait`: read.
  - `dismiss_dialog`: reversible.

  A type-level exhaustiveness check fails compilation if a kind has no entry (invariant 2).
- `packages/policy/src/risk/classifyRisk.ts`: `classifyRisk(intent, config)` is the max of the registry risk,
  the declared step risk and the irreversible rules (control-name patterns, routes). It never lowers.
- Tests: `actionRegistry.test.ts`, `classifyRisk.test.ts` (a "Confirm" click → irreversible; a declared
  `read` on a registry `reversible` → reversible).

### 15. Phase 3 — policy: the allowlist and evaluateAction

Skill: TDD

Create:

- `packages/policy/src/intent/ActionIntent.ts`: the type `ActionIntent`, with actor (`agent | replay |
  human`), kind, currentUrl, targetUrl?, targetName?, declaredRisk?, stepId?.
- `packages/policy/src/verdict/PolicyVerdict.ts`: a union on `kind`:
  - `allow` (risk);
  - `require_approval` (risk `irreversible`, reason);
  - `deny`, with code `origin_not_allowed | route_not_allowed | action_not_allowed | unknown_action`, and
    reason.
- `packages/policy/src/evaluate/evaluateAction.ts`: a pure evaluation, in order: unknown kind → action
  allowlist → origin → route → risk. It never throws; it always returns a verdict.
- `packages/policy/src/evaluate/evaluateLanding.ts`: the post-action landing URL check (define-action hard
  rule).
- `packages/policy/src/config/resolvePolicy.ts`: compiles a `PolicyConfig` into matchers (regex and glob
  precompiled). It is pure; the caller has already parsed and env-expanded the config.
- Tests: `evaluateAction.test.ts` (each deny code, and each actor gets the same verdict: AC9 at the unit
  level), `evaluateLanding.test.ts`.

### 16. Phase 3 — policy: redaction

Skill: TDD

Create:

- `packages/policy/src/redaction/Redacted.ts`: the branded type `Redacted<T>`. Sinks in `evidence` accept only
  this type. It is a compile-time guard for invariant 3.
- `packages/policy/src/redaction/createRedactor.ts`: `createRedactor({ config, sensitiveValues })` returns
  `{ redact, redactString, placeholderize }`.
  - `redact` walks objects and strings deeply and masks, in order: exact known sensitive values (params,
    credentials, extracted sensitive outputs) → config patterns (SSN-like, account-number-like,
    member-number-like) → config terms (synthetic names).
  - `placeholderize` replaces known param values with `{{paramName}}` instead of a mask. It is used for LLM
    observations, so the model reasons with placeholders.
  - `addSensitiveValue` extends the set at run time, e.g. after an extract.
- `packages/policy/src/redaction/defaultRedactionRules.ts`: the default patterns and mask styles, with a
  `REDACTION_RULES_VERSION`.
- `packages/policy/src/index.ts`: the barrel.
- Tests: `createRedactor.test.ts` covers:
  - nested objects and arrays;
  - a value inside longer text;
  - a balance amount that must not be over-masked by the member pattern;
  - placeholderize round trip;
  - idempotence (redacting twice gives the same result).

### 17. Phase 3 — evidence: run directory, run log, evidence store and manifest

Skill: TDD

Create:

- `packages/evidence/src/runs/RunDirectory.ts`: creates `.runs/<runId>/` with `run.jsonl`, `manifest.json`,
  `result.json`, `artifact.json`, `screenshots/`, `snapshots/`, `interventions/` and `prompts/`. The root is
  configurable, and tests use a temp dir.
- `packages/evidence/src/ids/newRunId.ts`: `newRunId(clock, random)` returns `<kind>-<yyyymmddThhmmss>-<4hex>`.
  The clock and randomness are injected.
- `packages/evidence/src/runlog/RunLog.ts`: the class `RunLog`.
  - `append(entry: Redacted<RunLogEntry>)` validates the entry with `RunLogEntrySchema` and writes one JSONL
    line through a pino file destination: sync mode, flushed on `close`.
  - `seq` is assigned internally.
  - `RunLog.create(runDir, redactor)` returns a writer whose `log(entry)` redacts first. There is no public
    way to write unredacted.
- `packages/evidence/src/store/EvidenceStore.ts`: the class `EvidenceStore`.
  - `putScreenshot(bytes: MaskedScreenshot)`, where `MaskedScreenshot` is a brand produced only by the surface
    masking helper; the brand type is defined in `policy`.
  - `putA11ySnapshot(tree: Redacted<unknown>)`, `putJson(name, Redacted<unknown>)`.
  - `putLocalOnly(path)` is for traces. It stores the file under `.runs/`, sets `localOnly: true` on the ref,
    and `/capture-evidence` never copies it.

  Every `put` returns an `EvidenceRef` with sha256.
- `packages/evidence/src/manifest/RunManifestWriter.ts`: accumulates refs, and writes `manifest.json`
  (validated) and `result.json` (redacted RunResult).
- `packages/evidence/src/errors/EvidenceWriteError.ts`: code `EVIDENCE_WRITE_FAILED`.
- `packages/evidence/src/index.ts`: the barrel.
- Tests:
  - `RunLog.test.ts`: a sensitive param value never appears in the file; each line validates; seq is
    monotonic.
  - `EvidenceStore.test.ts`.
  - `RunManifestWriter.test.ts`.

### 18. Phase 4 — mock-bank: server, sessions, synthetic data, frameset and login

Skill: define-mock-screen

Create:

- `apps/mock-bank/src/main.ts` reads `MOCKBANK_PORT`, `MOCKBANK_TENANT` (`a | b`),
  `MOCKBANK_SESSION_IDLE_MS`, `MOCKBANK_SLOW_MS` and `MOCKBANK_FAULTS`, and prints `listening <url>`. Update
  the `start` script to `node dist/main.js`.
- `apps/mock-bank/src/server.ts`: `createMockBankServer(config)` on `node:http`. There are no runtime
  dependencies.
- `apps/mock-bank/src/router.ts`: a table-driven route map.
- `apps/mock-bank/src/session/SessionStore.ts`: a cookie session with an idle timeout.
- `apps/mock-bank/src/data/members.ts`: the synthetic data set.
  - Members `12345` "Jane Sample", `12346` "John Placeholder" and `24680` "Ada Fixture".
  - Fake SSNs in the 900 range, fake 10-digit account numbers, and share-savings and checking balances.
  - Seed credentials `teller01` / `synthetic-pass-01`. These are synthetic and documented as such.
- `apps/mock-bank/src/html/legacy.ts`: helpers for layout tables nested three or more deep, generic
  `name`s (`txt1`, `btnGo`), and adjacent-cell labels. There are no ids, test ids or ARIA.
- `apps/mock-bank/src/screens/frameset.ts`: a top frameset with `banner`, `nav` and `content` frames.
- `apps/mock-bank/src/screens/login.ts`: the login form in the content frame.
- `apps/mock-bank/src/screens/nav.ts`: the menu.
- `apps/mock-bank/src/routes/health.ts`: `GET /__health`.
- Test: `apps/mock-bank/test/functional/login.test.ts` spawns the built server and uses `fetch` with HTML
  assertions. It covers the login ok, bad password and idle-expiry redirect cases.

### 19. Phase 4 — mock-bank: member search and member detail

Skill: define-mock-screen

Create:

- `apps/mock-bank/src/screens/memberSearch.ts`: a search form with the label "Member #" in an adjacent cell.
- `apps/mock-bank/src/screens/memberDetail.ts`: a detail page titled "Member Inquiry". Balances sit in a
  nested table with the row headers "Share Savings" and "Checking", and there is a link to "Open
  Sub-Account".
- `apps/mock-bank/src/screens/messages.ts`: server-rendered, non-semantic `<font color=red>` messages:
  - "No records match your search criteria";
  - "Invalid Member Number" for non-digit or wrong-length input.
- Test: `apps/mock-bank/test/functional/memberFlow.test.ts`.

### 20. Phase 4 — mock-bank: open sub-account, confirm and opened

Skill: define-mock-screen

Create:

- `apps/mock-bank/src/screens/openSubAccount.ts`: the form has a product select ("Holiday Club", "Vacation
  Savings"), an initial deposit and a nickname.
- `apps/mock-bank/src/screens/confirmSubAccount.ts`: a review page. Its "Confirm" button has an inline
  `onclick` that calls `window.confirm("This action cannot be undone. Continue?")`.
- `apps/mock-bank/src/screens/subAccountOpened.ts`: shows a confirmation number `SA-<seq>`. Server state is
  in memory, and `POST /__admin/reset` resets it.
- Test: `apps/mock-bank/test/functional/subAccountFlow.test.ts`.

### 21. Phase 4 — mock-bank: fault switches and error screens

Skill: define-mock-screen

Create:

- `apps/mock-bank/src/faults/FaultSwitch.ts`: faults are set with `POST /__admin/faults` or at start with
  `MOCKBANK_FAULTS`. Each fault has a mode `once | always` and an optional route filter. Faults are never
  random. The codes and the screens that render them:

  | Code | Effect |
  | --- | --- |
  | `member_not_found` | forces the search message |
  | `validation_error` | red message |
  | `permission_denied` | "You are not authorized for this function (SEC-403)" |
  | `known_dialog` | a native `alert` with "Scheduled maintenance tonight at 11 PM" on detail load |
  | `unknown_dialog` | a native `confirm` with unrecognised text |
  | `session_timeout` | expires the session on the next request |
  | `slow_load` | delays by `MOCKBANK_SLOW_MS` |
  | `failed_load` | 503 page, `once` |
  | `failed_load_persistent` | 503 page, always |
  | `app_error` | legacy "Runtime Error — ORA-06512" page with title "Server Error" |
  | `control_missing` | removes the Search button, for `target_unresolved` |
- `apps/mock-bank/src/screens/errors.ts`: renders the error and denial screens above.
- `apps/mock-bank/README.md`: the screens, the flows, the fault table (code → trigger → what renders), and the
  tenant differences.
- Test: `apps/mock-bank/test/functional/faults.test.ts` checks that each code renders its signal over HTTP.
  Native dialogs are asserted by the presence of the inline script.

### 22. Phase 4 — mock-bank: tenant-B variant

Skill: define-mock-screen

Create:

- `apps/mock-bank/src/tenants/tenants.ts`: a config per tenant. Tenant B has:
  - different branding and version string (`CoreOne 7.2` vs `7.4`);
  - the label "Account holder ID" instead of "Member #";
  - the search button text "Find" instead of "Search";
  - a reordered menu.

  The code is shared, not copied.
- Test: `apps/mock-bank/test/functional/tenantVariant.test.ts`.

### 23. Phase 4 — surface: the port, observation and Playwright launch

Skill: TDD (with Context7 for the current Playwright aria-snapshot and frame APIs)

Create:

- `packages/surface/src/port/Surface.ts`: the interface `Surface`. There are no Playwright types in it.
  - `observe(opts)` returns an `Observation`.
  - `resolve(target: TargetRef, bindings)` returns a `Resolution`.
  - `act(action: SurfaceAction)` returns an `ActOutcome`.
  - `check(checkpoint, bindings, timeoutMs)` returns a `CheckResult`.
  - `describe(ref)` returns an `ElementFingerprint`.
  - `captureEvidence(redactor)` returns a masked screenshot and a redacted a11y tree.
  - `location()`, `pendingDialog()`, `close()`.
- `packages/surface/src/port/Observation.ts`:
  - `Observation`: url, title, frames, tree, pendingDialog, lastNavigation (`{ status, durationMs }`),
    `digest` (a hash for no-progress detection).
  - `A11yNode`: ref `e<N>`, role, name, value?, framePath, children.
- `packages/surface/src/port/SurfaceAction.ts`: the union mirroring the step kinds, with resolved bindings.
  Targets are a `TargetRef` (replay) or an observation `ref` (agent).
- `packages/surface/src/port/ElementFingerprint.ts` gives the compiler what it needs to build a ladder:
  - role, name, tag, name attribute;
  - adjacent label-cell text, row header text, column header text;
  - frame path, index within its container.
- `packages/surface/src/playwright/launchWebSurface.ts`: options `headless`, `slowMo`, `viewport`,
  `allowedOrigins`. It returns a `WebSurface` and a `BrowserHandle`, an opaque handle that session keeps for
  the handoff.
- `packages/surface/src/playwright/WebSurface.ts`: the class implementing `Surface`.
- `packages/surface/src/playwright/a11ySnapshot.ts` builds a frame-aware accessibility tree. It walks
  `page.frames()`, takes each frame's aria snapshot and assigns refs. A ref-to-locator map is kept per
  observation.
- `packages/surface/src/playwright/networkGuard.ts`: `context.route('**')` aborts requests to non-allowlisted
  origins. This is defence in depth; the policy check stays the primary gate.
- Errors: `packages/surface/src/errors/{FrameNotFoundError,SurfaceClosedError,NavigationBlockedError}.ts`.
- Tests:
  - `a11ySnapshot.test.ts`: a unit test on a recorded snapshot fixture, with no browser.
  - `packages/surface/test/functional/observe.test.ts`: the frames of `mock-bank` appear in one tree.

### 24. Phase 4 — surface: the locator-ladder resolver and element fingerprint

Skill: TDD

Create:

- `packages/surface/src/locators/FrameResolver.ts` resolves a FrameScope to a Playwright `Frame`, hop by hop.
- `packages/surface/src/locators/rungToLocator.ts`:
  - `role` → `getByRole`;
  - `label` → `getByLabel`;
  - `text` → `getByText`;
  - `structural` → a frame-scoped XPath built from header or label text, e.g. the cell after the one whose
    normalized text equals the header.

  Every locator is strict: exactly one match, or the rung fails.
- `packages/surface/src/locators/LadderResolver.ts` walks the rungs in order and returns `{ rungIndex,
  rungKind }`, or throws `TargetNotResolvedError` with a per-rung observation (`0 matches` / `N matches`).
  Before failing, it re-resolves once to handle a stale frame (spec edge case).
- `packages/surface/src/locators/fingerprintElement.ts`: a `page.evaluate` in the element's frame that
  returns an `ElementFingerprint`.
- `packages/surface/src/errors/TargetNotResolvedError.ts`: code `TARGET_UNRESOLVED`.
- Tests:
  - `rungToLocator.test.ts` (unit, the XPath strings);
  - `packages/surface/test/functional/ladder.test.ts`: role rung on tenant A; fallback to the structural rung
    on tenant B, where the label differs; unresolvable with `control_missing`.

### 25. Phase 4 — surface: action executors and the dialog monitor

Skill: define-action (touch point 3, all eight kinds)

Create:

- `packages/surface/src/actions/executors/{navigate,click,fill,select,press,extract,wait,dismissDialog}.ts`:
  one executor per kind. Each resolves the target, acts, waits for load state, and returns `ActOutcome`:
  landing url, navigation status and duration, and the extracted value for `extract`.
- `packages/surface/src/actions/executeAction.ts`: an exhaustive dispatch over the kinds.
- `packages/surface/src/dialogs/DialogMonitor.ts` subscribes to `page.on('dialog')` and holds the dialog as
  pending, without auto-accepting it. It exposes the dialog in `Observation.pendingDialog`. `dismiss_dialog`
  settles it.
  - An action attempted while a dialog is pending fails fast with `DialogPendingError` instead of hanging.
  - An irreversible click's own `confirm` is settled only by the approval path (step 34).
- Test: `packages/surface/test/functional/actions.test.ts`, one scenario per kind against `mock-bank`.

### 26. Phase 4 — surface: the policy-guarded surface and masked evidence capture

Skill: TDD

Create:

- `packages/surface/src/guard/PolicyGuardedSurface.ts` decorates any `Surface`. Before every `act` it:
  1. builds an `ActionIntent`, using the accessible name of the resolved target;
  2. calls `evaluateAction`;
  3. on `deny`, logs the verdict and throws `PolicyDeniedError`;
  4. on `require_approval`, throws `ApprovalRequiredError`, unless the call carries an `ApprovalGrant` bound to
     the same stepId or target fingerprint and requestId, which is single-use and unexpired;
  5. after acting, calls `evaluateLanding`.

  This is the only `Surface` that session, replay and agent receive (invariant 2).
- `packages/surface/src/guard/ApprovalGrant.ts`: the type plus `consumeGrant`.
- `packages/surface/src/evidence/captureMaskedScreenshot.ts` builds Playwright `mask` locators for every
  element whose text contains a known sensitive value or matches a redaction pattern. It returns a
  `MaskedScreenshot`. `captureEvidence` redacts the a11y tree through the redactor.
- Errors: `packages/surface/src/errors/{PolicyDeniedError,ApprovalRequiredError,DialogPendingError}.ts`.
- Tests:
  - `PolicyGuardedSurface.test.ts` (unit, with a fake inner surface): the verdicts, grant consumption, and a
    reused grant being rejected;
  - `packages/surface/test/functional/maskedScreenshot.test.ts`.

### 27. Phase 4 — surface: the human-action recorder (mediated control)

Skill: define-action (touch point 6, all human-performable kinds)

Create:

- `packages/surface/src/recorder/captureScript.ts`: a script injected with `context.addInitScript` into every
  frame. It intercepts `click`, `submit` and Enter `keydown` in the capture phase, calls `preventDefault`,
  and forwards a descriptor (frame path, element path, event) through `context.exposeBinding`. It reports
  `change` on inputs and selects as `fill` / `select` without blocking.
- `packages/surface/src/recorder/mapDomEventToStep.ts` maps a DOM descriptor to a recorded action: kind,
  element fingerprint and value. Fill values are marked sensitive.
- `packages/surface/src/recorder/HumanActionRecorder.ts`:
  - `start(guard, onRecorded)` / `stop()`.
  - For each intercepted action it asks the guard: an allowed action is re-executed through the executor and
    recorded as `human_action` with verdict `allow`; a denied one is not executed, is recorded as refused, and
    shows an in-page banner.
  - `navigate`, `extract`, `wait` and `dismiss_dialog` are not interceptable DOM gestures. `dismiss_dialog`
    is mapped from the `dialog` event instead. `navigate` through the address bar is blocked by the network
    guard and recorded as refused.
- Tests:
  - `mapDomEventToStep.test.ts` (unit);
  - `packages/surface/test/functional/recorder.test.ts`: simulated human clicks are recorded; an off-allowlist
    link is refused and not executed.

### 28. Phase 4 — surface: shared functional test harness

Skill: write-functional-test (harness creation)

Create:

- `packages/surface/src/testing/launchMockBank.ts` spawns `apps/mock-bank/dist/main.js`. It resolves the repo
  root from `import.meta.url`, so nothing imports the package. It uses a free port, env for tenant and faults,
  waits on `/__health`, and returns `{ origin, setFault, reset, stop }`.
- `packages/surface/src/testing/browserFixture.ts`: one headless browser per file, a fresh context per test.
- `packages/surface/src/testing/SimulatedOperator.ts` performs "human" gestures with real DOM events in the
  page (`page.mouse`, `keyboard`), so the recorder's injected listener is exercised as it would be for a real
  person.
- `packages/surface/src/testing/index.ts`, and the package.json `exports` subpath `./testing`.
- `packages/surface/src/index.ts`: the barrel. Playwright types stay internal.

### 29. Phase 5 — session: the control-lease state machine

Skill: TDD

Create:

- `packages/session/src/lease/ControlLease.ts`: the class `ControlLease`.
  - States: `AGENT`, `PAUSED`, `HUMAN`, `RESUMING`, `CLOSED`. Legal transitions:
    - `pause(reason, requestId)`: AGENT → PAUSED.
    - `cede(operator)`: PAUSED → HUMAN.
    - `approve(operator, requestId)`: PAUSED → RESUMING.
    - `reject(operator)`: PAUSED → CLOSED.
    - `resume(operator)`: HUMAN → RESUMING.
    - `reacquire()`: RESUMING → AGENT, only after the caller has verified the checkpoint.
    - `close(actor)`: from any state.
  - Transitions run through a promise queue, so they are serialized.
  - A duplicate of the transition just applied is idempotent: it returns the current state without an error.
    Any other illegal transition throws `IllegalLeaseTransitionError`.
  - `history()` returns the list of `LeaseTransition`s. `onChange(listener)` is available. `holder()` returns
    `agent | human | none`.
- `packages/session/src/errors/{IllegalLeaseTransitionError,LeaseNotHeldError}.ts`.
- Test: `ControlLease.test.ts` covers every legal and illegal edge, a double resume, a resume racing a pause,
  and the history order.

### 30. Phase 5 — session: the leased surface and the intervention service

Skill: TDD

Create:

- `packages/session/src/lease/LeasedSurface.ts` decorates the guarded surface. An `act` from actor `agent` or
  `replay` requires `AGENT`; one from `human` requires `HUMAN`. Otherwise it throws `LeaseNotHeldError`.
  Observation is always allowed.
- `packages/session/src/intervention/InterventionService.ts`:
  - `raise({ kind, reason, subject, currentStep })`:
    1. captures masked evidence through the surface;
    2. builds a redacted `InterventionRequest`;
    3. persists it with `EvidenceStore.putJson`;
    4. logs the `intervention` entry;
    5. calls `lease.pause`.
  - `awaitResolution(id, { timeoutMs })` returns the resolution.
  - `list()`, `get(id)`.
- Tests: `LeasedSurface.test.ts`, `InterventionService.test.ts` (fake surface and store; no raw value in the
  persisted request).

### 31. Phase 5 — session: the control API, client and live-session composition

Skill: TDD

Create:

- `packages/session/src/control/ControlServer.ts` runs on `node:http`, bound to `127.0.0.1` on a configurable
  port. It requires the bearer token generated per session. JSON routes:
  - `GET /lease`
  - `GET /interventions`, `GET /interventions/:id`
  - `GET /evidence/:refId`: serves masked screenshots and redacted snapshots only.
  - `POST /interventions/:id/claim`: cede, and bring the headed window to the front.
  - `POST /interventions/:id/approve`: mint an `ApprovalGrant`, then approve.
  - `POST /interventions/:id/reject`
  - `POST /resume`
  - `POST /abort`

  Every body is validated with the artifact-schema contracts.
- `packages/session/src/control/ControlClient.ts`: a typed HTTP client, used by operator and tests.
- `packages/session/src/LiveSession.ts` composes the live session.
  - `openLiveSession({ policy, redactor, runDir, headless, attended, controlPort })` launches the web surface
    and stacks guard → lease. It creates the run log and evidence store, starts the control server when
    attended, and wires the recorder to lease changes: record while `HUMAN`, stop on `RESUMING`.
  - It exposes `surface` (leased), `lease`, `interventions`, `runLog`, `evidence`, `controlUrl`.
  - `requestApproval(step)`: raise an approval request and await it; returns a grant, a rejection or a
    timeout.
  - `escalate(reason)`: raise a takeover request, await resume, and return the recorded human actions.
  - `close()`.
- `packages/session/src/index.ts`: the barrel.
- Tests:
  - `ControlServer.test.ts` (unit, with a fake session): token required, 127.0.0.1 only, validation.
  - `packages/session/test/functional/handoff.test.ts`: `mock-bank` plus a real headless surface.
    1. The agent holds the lease.
    2. `escalate` is called.
    3. The operator claims through `ControlClient`.
    4. `SimulatedOperator` clicks Search.
    5. The operator resumes.

    It asserts the lease history reads `AGENT → PAUSED → HUMAN → RESUMING → AGENT` and the recorded action has
    a ladder-ready fingerprint. An agent `act` while `HUMAN` throws `LeaseNotHeldError`.

### 32. Phase 5 — replay-engine: skeleton, params, checkpoints, outputs and result builder

Skill: TDD

Create:

- `packages/replay-engine/src/ReplayEngine.ts`: `replay({ artifact, params, session, profile?,
  credentials, options })` returns a `RunResult`. It never throws for run-level problems.
  1. Parse the artifact with the schema and verify `contentHash`. A mismatch fails with `artifact_invalid`.
  2. Validate the params with `paramsSchemaFor`. A mismatch fails with `invalid_params` **before any surface
     call** (AC8).
  3. Seed the redactor with the sensitive param values.
  4. Run the steps through `StepRunner`.
  5. Verify `successCondition`.
  6. Extract the outputs and validate them with `outputsSchemaFor`. A mismatch fails with `output_invalid`.
  7. Build the result, then write `result.json` and the manifest.
- `packages/replay-engine/src/ReplayOptions.ts`: the defaults and their bounds:
  - `attended: false`;
  - `stepTimeoutMs: 10_000`, `checkpointTimeoutMs: 10_000`, `slowLoadBudgetMs: 15_000`;
  - `retry { max: 2, backoffMs: 500 }`;
  - `maxDialogDismissPerStep: 1`, `maxReauthPerRun: 1`;
  - `approvalTimeoutMs: 300_000`.
- `packages/replay-engine/src/params/bindValues.ts` resolves a ValueExpr: a param from the params, or a
  credential through the `CredentialProvider` port. Credentials are added to the redactor as soon as they
  are resolved.
- `packages/replay-engine/src/params/CredentialProvider.ts`: the port interface. The CLI supplies an
  env-backed implementation.
- `packages/replay-engine/src/checkpoints/CheckpointVerifier.ts`: a bounded poll of `surface.check` that
  races the condition detectors (step 35 onwards). It returns `held | condition(code) | timeout`.
- `packages/replay-engine/src/outputs/extractOutputs.ts`: parses per `extract.parse`, then validates.
- `packages/replay-engine/src/result/ResultBuilder.ts`: `success`, `businessOutcome` and `failure`. Failure
  captures masked evidence (a screenshot and an a11y snapshot) and attaches refs (AC13).
- `packages/replay-engine/src/errors/ReplayError.ts`: an internal typed error with a stable `code`, mapped to
  a `FailureReason`.
- Tests: `ReplayEngine.test.ts` (a fake session surface: invalid params means zero surface calls; hash
  mismatch), `bindValues.test.ts`, `extractOutputs.test.ts`.

### 33. Phase 5 — replay-engine: step handlers

Skill: define-action (touch point 4, all eight kinds)

Create:

- `packages/replay-engine/src/steps/handlers/{navigate,click,fill,select,press,extract,wait,dismissDialog}.ts`:
  one handler per kind. Each binds values, calls the guarded and leased surface (policy runs inside the
  guard, before the action), logs `locator_resolved` (the rung) and `action`, then verifies the step
  checkpoint with `CheckpointVerifier`. A rung index above 0 is appended to `drift` (FR11).
- `packages/replay-engine/src/steps/StepRunner.ts`: the per-step loop.
  1. Pre-observe: detect a pending dialog or condition.
  2. Run the handler.
  3. Post-check.
  4. Consult the condition catalog on any detected condition.
- Test: `packages/replay-engine/test/functional/replayMemberLookup.test.ts`, using the fixture artifact
  against `mock-bank`.
  - Success returns the seeded savings balance (AC4).
  - A run log entry exists per step with its rung and checkpoint.
  - Tenant B: success with non-empty `drift`.
  - The no-LLM check: the model client is never constructed. This holds by construction, since no model
    exists anywhere in the dependency graph.

### 34. Phase 5 — replay-engine: the approval gate and attended escalation

Skill: TDD

Create:

- `packages/replay-engine/src/escalation/handleApproval.ts`: on `ApprovalRequiredError`:
  - **attended**: call `session.requestApproval`. On a grant, retry the same step with the grant. The step's
    own native `confirm` is then accepted as part of the approved action. On a rejection, fail with
    `approval_rejected`; on a timeout, fail with `timeout`.
  - **unattended**: raise the request (persisted) and fail with `approval_required` plus
    `interventionRequestId`.
- `packages/replay-engine/src/escalation/handleHardFailure.ts`:
  - **attended**: `session.escalate`. After resume, re-observe and re-verify the current step's checkpoint.
    If it holds, continue from the next step; if not, fail with `checkpoint_failed`.
  - **unattended**: fail with the intervention ref.
- Test: `packages/replay-engine/test/functional/approvalAndHandoff.test.ts`.
  - `open-sub-account` attended: PAUSED, an approval request with redacted context, an operator approve via
    `ControlClient`, then success with the confirmation number (AC10).
  - Unattended: `approval_required` with a ref.
  - Reject: `approval_rejected`.
  - `app_error` attended: the operator claims, `SimulatedOperator` performs the fix, the operator resumes, the
    run completes, and the lease history is as in AC11.

### 35. Phase 5 — runtime condition `member_not_found` (business_outcome)

Skill: define-runtime-condition (args: `member_not_found business_outcome search returns no member`)

Create / Modify:

- `packages/replay-engine/src/conditions/ConditionCatalog.ts` (created here): `CONDITION_CATALOG`, keyed by
  code. Each entry has a default class, detector id, response and budget. The artifact's `outcomeRules`
  override the entry for their scope. Resolution order: artifact rule → app profile → catalog default.
- `packages/replay-engine/src/conditions/detectConditions.ts` (created here): evaluates the
  `ConditionSignature`s against an `Observation`.
- The signature lives in the fixture artifact's outcome rules and in `config/apps/mock-bank.profile.json`
  (step 55). The `mock-bank` fault already exists (step 21).
- Test: `packages/replay-engine/test/functional/conditions/memberNotFound.test.ts`. It uses the natural
  trigger (unknown id 99999) and asserts exactly `business_outcome` / `member_not_found` (AC6).

### 36. Phase 5 — runtime condition `validation_rejected` (business_outcome)

Skill: define-runtime-condition (args: `validation_rejected business_outcome app rejects a caller-supplied value`)

- Test: `.../conditions/validationRejected.test.ts`. Input `12a45` passes a loosened param pattern and is
  rejected by the app. The message is redacted.
  - Also tests `invalid_params` when the param pattern rejects the value first (AC8, zero surface calls).

### 37. Phase 5 — runtime condition `permission_denied` (business_outcome)

Skill: define-runtime-condition (args: `permission_denied business_outcome operator lacks entitlement`)

- Test: `.../conditions/permissionDenied.test.ts`.

### 38. Phase 5 — runtime condition `known_dialog` (recoverable)

Skill: define-runtime-condition (args: `known_dialog recoverable recognised maintenance alert is dismissed`)

- Detector: a `dialog_text` signature from the profile's `knownDialogs`.
- Recovery: dismiss, at most once per step.
- Test: `.../conditions/knownDialog.test.ts`. Recovered means success and a `recovery` log entry. With budget
  0 (the alert shown twice in one step), the result is `failure` / `recovery_exhausted`.

### 39. Phase 5 — runtime condition `slow_load` (recoverable)

Skill: define-runtime-condition (args: `slow_load recoverable bounded wait then failed load`)

- Test: `.../conditions/slowLoad.test.ts`.
  - `MOCKBANK_SLOW_MS` is below the budget: success with a recovery entry.
  - It is above the budget: the load is treated as failed and follows the failed-load path.

  The test injects small budgets through `ReplayOptions` to stay fast.

### 40. Phase 5 — runtime condition `failed_load` (recoverable)

Skill: define-runtime-condition (args: `failed_load recoverable bounded retry of the step`)

- Detector: an `http_status` 5xx on the navigation with no app-error signature.
- Test: `.../conditions/failedLoad.test.ts`. With `once`, the result is success after a retry. With
  `failed_load_persistent`, it is `failure` / `recovery_exhausted` with evidence.

### 41. Phase 5 — runtime condition `session_timeout` (recoverable)

Skill: define-runtime-condition (args: `session_timeout recoverable one re-auth then resume`)

- Recovery:
  1. Re-run the artifact's `login`-phase steps once.
  2. Re-run the `main` steps from the first step up to the one that failed.
  3. If any already-executed step was `irreversible`, fail with `session_lost` instead of re-running it.
- Test: `.../conditions/sessionTimeout.test.ts`. A single expiry ends in success. A second expiry ends in
  `failure` / `session_lost`.

### 42. Phase 5 — runtime condition `unknown_dialog` (failure)

Skill: define-runtime-condition (args: `unknown_dialog failure unrecognised native dialog`)

- Test: `.../conditions/unknownDialog.test.ts`. The result is `failure` / `unknown_dialog` with screenshot and
  snapshot refs. The dialog is left unaccepted; the run never auto-accepts.

### 43. Phase 5 — runtime condition `app_error` (failure)

Skill: define-runtime-condition (args: `app_error failure legacy server error page`)

- Test: `.../conditions/appError.test.ts`. The result is `failure` / `app_error`, and the evidence refs exist
  in the manifest (AC13).

### 44. Phase 5 — runtime conditions `target_unresolved` and `checkpoint_failed` (failure)

Skill: define-runtime-condition (args: `target_unresolved failure no ladder rung matches`)

- `control_missing` gives `failure` / `target_unresolved`. `observed` lists every rung with its match count.
- A checkpoint mismatch is forced with a fixture whose checkpoint text is wrong. It gives `failure` /
  `checkpoint_failed`, with expected vs observed.
- Test: `.../conditions/targetAndCheckpoint.test.ts`.

### 45. Phase 5 — agent: the model port, scripted model and Anthropic client

Skill: TDD (with Context7 and the `claude-api` skill for the SDK and model ids)

Create:

- `packages/agent/src/model/ModelClient.ts`: the port.
  - `next({ system, messages, tools })` returns a `ModelTurn`: toolCalls (id, name, input), text,
    stopReason, usage.
- `packages/agent/src/model/ScriptedModel.ts`: a deterministic fake that replays a script of tool calls.
  Targets in the script are `{ role, name }`, resolved to the current observation's ref at run time. It can
  script wrong or looping behaviour for the stop-condition tests. It is exported from the barrel, because the
  CLI's no-API-key discovery uses it (FR24).
- `packages/agent/src/model/AnthropicModelClient.ts`:
  - `@anthropic-ai/sdk` Messages API with tool use.
  - The model comes from config: `IDP_MODEL`, default `claude-sonnet-5-5`.
  - `max_tokens` is bounded, and prompt caching is on for the system prompt and tools.
  - It is constructed only by `discover`, and fails fast with `MissingApiKeyError` when no key is set.
- `packages/agent/scripts/member-lookup.script.json` and `open-sub-account.script.json`: the demo and test
  scripts.
- Tests: `ScriptedModel.test.ts`, `AnthropicModelClient.test.ts` (the SDK is mocked at the module boundary; no
  network).

### 46. Phase 5 — agent: tools, observation formatter and prompt

Skill: define-action (touch point 5, all eight kinds) + TDD

Create:

- `packages/agent/src/tools/toolDefinitions.ts` has one tool per action kind. Every tool has a required
  `reason` field (FR4) and names its target by observation `ref`. Values for `fill` / `select` are a literal
  or a `{{placeholder}}`.

  The control tools are:
  - `declare_output`: name, type, sensitive.
  - `finish`: summary, `finalCheckpoint` (a text or element proposal).
  - `request_help`: reason.
- `packages/agent/src/tools/toolToAction.ts` maps a tool call to a `SurfaceAction`. An unknown tool is a tool
  error, fed back to the model.
- `packages/agent/src/observe/formatObservation.ts` renders the redacted, **placeholderized** a11y tree as
  compact indented text with refs, frames and a pending dialog. The size cap truncates deep subtrees
  deterministically.
- `packages/agent/src/prompt/systemPrompt.ts` holds the goal (placeholderized), the allowed tools, the
  parameter names available as placeholders, and the rules: one action per turn, a reason on every call,
  finish only when the goal is visibly met.
- Tests: `toolDefinitions.test.ts` (one tool per registry kind; exhaustive), `formatObservation.test.ts` (no
  raw example values, only placeholders).

### 47. Phase 5 — agent: the discovery loop and stop conditions

Skill: TDD

Create:

- `packages/agent/src/loop/DiscoveryLoop.ts`: `run({ goal, target, exampleInputs, session, model, options })`
  returns a `DiscoveryOutcome`, a union of:
  - `goal_met`: trace + verified final checkpoint;
  - `stopped`: reason `max_steps | timeout | dead_end | policy_blocked | goal_unverified | model_gave_up |
    human_aborted`.

  Each turn is observe → placeholderize/redact → model → policy (inside the guard) → act → record a
  `TraceStep`. Policy refusals and resolution errors go back to the model as tool errors and count toward the
  budget.
- `packages/agent/src/loop/StopConditions.ts`:
  - `maxSteps`, default 25.
  - `timeoutMs`, default 300_000.
  - `deadEnd`: the same observation digest three times with no progress, or an A-B-A-B oscillation.
  - `policyBlocked`: 3 consecutive denials.
  - `unverifiedFinish`: 2 finishes whose checkpoint does not hold give `goal_unverified`.
- Escalation during discovery:
  - A dead end or `request_help` while attended calls `session.escalate`. Recorded human actions are appended
    to the trace as `actor: human`.
  - An irreversible action calls `session.requestApproval`.
- `packages/agent/src/trace/DiscoveryTrace.ts`: a structured trace, separate from the transcript. Each step
  holds the action, element fingerprint, observation digest before and after, a post-action diff summary,
  the actor and the verdict.
- Redacted prompts are written to `prompts/turn-NN.json` through the evidence store, and `decision` log entries
  carry the model's reason.
- Test: `packages/agent/test/functional/discoveryStops.test.ts`, with `ScriptedModel` against `mock-bank`. It
  covers each stop reason and asserts no artifact is compiled (AC2). The timeout case uses an injected clock.

### 48. Phase 5 — agent: the artifact compiler

Skill: TDD

Create:

- `packages/agent/src/compiler/ArtifactCompiler.ts`: `compile(trace, { goal, params, outputs, profile, policy,
  runId })` returns a `CapabilityArtifact`.
  1. Keep only successful, non-refused steps.
  2. Collapse repeated fills on the same target.
  3. Use the trace's `{{param}}` values as `param` ValueExprs, and turn credential fills into `credential`
     refs.
  4. Tag the steps before the first post-login checkpoint as phase `login`.
  5. Set each step's risk with `classifyRisk`.
  6. Copy `outcomeRules` from the profile.
  7. Generate `summary` deterministically from the goal, params and outputs, not with an LLM.
  8. Assign stable step ids.
  9. Compute `contentHash`.
- `packages/agent/src/compiler/buildLocatorLadder.ts` builds the ladder from an `ElementFingerprint`, in this
  order: role+name (when the name is non-empty and not a param value), then label or text, then a structural
  anchor (table-cell-relative from row or column headers, or form-row from the adjacent label cell). Each
  rung gets a templated rationale.
- `packages/agent/src/compiler/deriveCheckpoint.ts` picks the post-action checkpoint from the before/after
  diff, preferring:
  1. a changed title or heading text;
  2. a newly visible role+name element;
  3. a route change.

  A step with no verifiable change fails compilation with `UncheckpointableStepError`. It never emits a step
  without a checkpoint (invariant 5).
- `packages/agent/src/compiler/assertNoConcreteValues.ts` serializes the artifact and scans it for every
  example input, credential and extracted value. Any hit throws `ConcreteValueLeakError` (invariant 3).
- `packages/agent/src/DiscoveryRunner.ts` composes: open the session → run the loop → compile only on
  `goal_met` → write `artifact.json` and the manifest → return `{ outcome, artifactPath? }`.
- `packages/agent/src/index.ts`: the barrel.
- Tests:
  - `buildLocatorLadder.test.ts`, `deriveCheckpoint.test.ts`, `assertNoConcreteValues.test.ts`,
    `ArtifactCompiler.test.ts` (from a recorded trace fixture, the output validates and matches the golden
    `member-lookup` shape).
  - `packages/agent/test/functional/discoverMemberLookup.test.ts`: the scripted discovery of member-lookup
    compiles an artifact that validates, contains `{{memberId}}` and never contains `12345` (the AC1 shape
    without an LLM). The replay half of the round trip lives in `apps/cli` (step 50), because `agent` and
    `replay-engine` share a layer and BND001 rejects same-layer dependencies, even as devDependencies.

### 49. Phase 5 — replay-engine: the no-LLM boundary proof

Skill: write-unit-test

Create:

- `packages/replay-engine/src/noLlmBoundary.test.ts` (AC5):
  - uses `@idp/repo-checks` to read the workspace graph and assert that the transitive closure of
    `@idp/replay-engine` contains neither `@idp/agent` nor `@anthropic-ai/sdk`;
  - greps `packages/replay-engine/src` for any import of either.

### 50. Phase 6 — cli: commands

Skill: TDD

Create:

- `apps/cli/src/main.ts`: `node:util` `parseArgs` dispatch.
  - Exit codes: 0 success or goal met, 3 business outcome, 1 failure, 4 discovery stopped, 64 usage error.
- `apps/cli/src/config/loadConfig.ts`:
  - loads `config/policy.json` and expands `${MOCKBANK_ORIGIN}`;
  - loads `config/apps/<app>.profile.json`;
  - reads `.env` through `process.loadEnvFile` when present. It never prints values.
- `apps/cli/src/config/EnvCredentialProvider.ts` maps the credential ref `mockbank_operator` to
  `MOCKBANK_OPERATOR_USER` / `MOCKBANK_OPERATOR_PASSWORD`.
- `apps/cli/src/commands/discover.ts`:
  - flags `--goal`, `--target`, `--input k=v` (repeatable), `--sensitive k`, `--output name:type`,
    `--profile`, `--model scripted:<file> | anthropic`, `--attended`, `--headed`, `--out artifacts/<id>.json`;
  - `--verify-replay` is on by default. After compiling, the command replays the new artifact once with the
    example inputs through `@idp/replay-engine` and writes it to `--out` only if that replay returns
    `success`. The agent package cannot do this itself, because it may not import `replay-engine`.
  - prints the redacted outcome, the artifact path and the run dir.
- `apps/cli/src/commands/replay.ts`:
  - flags `--artifact`, `--param k=v`, `--attended`, `--headed`, `--profile`;
  - prints the redacted `RunResult` as JSON, plus a one-line human summary.
  - It never imports `@idp/agent` at runtime. A lint rule scoped to this file restricts that import.
- `apps/cli/src/commands/catalog.ts` lists `artifacts/*.json`: id, version, summary, params, outputs, hash
  status (verified or mismatch). `--verify` exits non-zero on a mismatch.
- `apps/cli/src/commands/operator.ts` spawns the operator app by path (it does not import it) with the
  control URL and token of a running attended session.
- `apps/cli/src/output/printResult.ts`: all output goes through the redactor.
- Tests:
  - `parseArgs.test.ts`, `loadConfig.test.ts`, `printResult.test.ts` (no raw values);
  - `apps/cli/test/functional/cli.test.ts` spawns the built CLI:
    - `replay` of the fixture returns success with exit 0;
    - an unknown member exits 3;
    - `discover --model scripted:...` produces a valid artifact, which `replay` then runs for 12345
      (success) and 99999 (`member_not_found`). This is the discover → artifact → replay round trip without
      an LLM;
    - `discover --model anthropic` without a key fails fast with a clear message.

### 51. Phase 6 — operator: the minimal console

Skill: TDD

Create:

- `apps/operator/src/main.ts` reads `IDP_CONTROL_URL`, `IDP_CONTROL_TOKEN` and `IDP_OPERATOR_PORT`.
- `apps/operator/src/server.ts`: `node:http`. It serves the console and proxies to the session through
  `ControlClient`, so the browser never sees the token.
- `apps/operator/src/views/{layout,interventionList,interventionDetail,leaseBadge}.ts`: server-rendered HTML
  and a small polling script.
  - The detail view shows the masked screenshot, reason, step and risk.
  - Buttons: Take control, Approve, Reject, Resume, Abort.
  - A banner states it is a deliberately mocked console, and links to REPORT §5.
- Tests:
  - `views.test.ts`: rendering from a fixture request; everything shown is already redacted; no raw value
    appears.
  - `apps/operator/test/functional/console.test.ts` runs a real `ControlServer` on a fake session and checks
    that claim, approve and resume round-trip.

### 52. Phase 6 — config: policy and app profiles

Skill: glue

Create:

- `config/policy.json`:
  - origins: `${MOCKBANK_ORIGIN}`;
  - routes: everything under the app except `/__admin/**`;
  - all eight actions;
  - irreversible control-name patterns: `^Confirm$`, `^Submit$`, `Open Account`, `Transfer`, `Delete`;
  - redaction patterns (SSN-like, 10-digit account, 5-digit member number) and synthetic name terms.
- `config/apps/mock-bank.profile.json`: tenant A signatures for every condition in steps 35–44, the login
  route, `credentialRef` `mockbank_operator`, and the known maintenance dialog.
- `config/apps/mock-bank.tenant-b.profile.json`: tenant B's relabelled signatures. This is the R7.2 demo of
  per-tenant specialisation at the profile level.
- `config/README.md`: what each file controls.

### 53. Phase 6 — artifacts: the committed example capabilities

Skill: glue

Create:

- `artifacts/README.md`: the catalog directory, and how artifacts get here (`discover --out`).
- `artifacts/member-lookup.json` and `artifacts/open-sub-account.json` are first copied from the fixtures so
  the no-API-key demo path works. After the PoC-approved real run in step 58, `member-lookup.json` is
  replaced by the discovered artifact.

### 54. Phase 7 — lint rule: replay command never reaches the agent

Skill: glue

Modify:

- `eslint.config.js`: add a `no-restricted-imports` override for `apps/cli/src/commands/replay.ts` and
  `apps/cli/src/commands/catalog.ts` that forbids `@idp/agent`. This mirrors `apps/cli/CLAUDE.md`
  ("`replay` never constructs or calls the agent").

### 55. Phase 7 — docs: packages and root

Skill: update-docs (for `packages/artifact-schema`, `packages/policy`, `packages/evidence`,
`packages/surface`, `packages/session`, `packages/replay-engine`, `packages/agent`, `apps/cli`,
`apps/operator`, `apps/mock-bank`, and root)

Modify:

- Each package `CLAUDE.md`: change "Status: Shell" to the real status, update the file layout (registry
  locations for `define-action` and the condition catalog), and record the allowed deps (`cli` gains
  `policy` and `evidence`; `evidence` gains `pino`).
- Each `README.md`: the public API.
- Root `CLAUDE.md`, "Commands": `pnpm test` is unit only; add `pnpm test:functional` (needs
  `pnpm setup:browsers`), `pnpm mock-bank`, `pnpm idp <discover|replay|catalog|operator>` and
  `pnpm operator`.
- Root `README.md`:
  - Configuration: the `.env` keys.
  - Running without live services: tests, replay of the committed artifacts, scripted discovery.
  - The Demo path: `pnpm mock-bank` → `pnpm idp discover --goal "look up member 12345 and read their current
    savings balance" --target http://127.0.0.1:4010/ --input memberId=12345 --sensitive memberId --output
    savingsBalance:decimal --out artifacts/member-lookup.json` → `pnpm idp replay --artifact
    artifacts/member-lookup.json --param memberId=12345` → the not-found and fault variants → the attended
    handoff with `pnpm idp operator`.

### 56. Phase 7 — ADRs

Skill: `/define-adr` (one run per decision; the PoC runs these)

Create:

- `docs/adr/0002-proxy-target-hostile-mock-bank.md`: the report's §1.
- `docs/adr/0003-artifact-schema-and-locator-ladder.md`: includes app profiles vs inline rules, and the
  content hash.
- `docs/adr/0004-result-contract-and-runtime-condition-taxonomy.md`
- `docs/adr/0005-policy-risk-classes-and-approval.md`: includes the network guard as defence in depth.
- `docs/adr/0006-control-transfer-lease-and-mediated-human-control.md`: includes the localhost control API.
- `docs/adr/0007-surface-abstraction-a11y-first.md`: R7.1, the desktop mapping to UIA/AX.
- `docs/adr/0008-multi-tenant-reuse-base-overrides-and-drift.md`: R7.2, profiles per tenant, `extends`,
  drift from rung fallback.
- `docs/adr/0009-redaction-model-and-evidence-sinks.md`: placeholderized prompts, masked screenshots, and
  traces kept local-only.
- `docs/adr/README.md`: the index rows.

### 57. Phase 7 — the report

Skill: `/update-report`

Modify:

- `REPORT.md`: the seven exact headings, filled from ADRs 0001–0009, with the cuts: S1–S6, desktop surface,
  co-browsing, traces not committed, and the override mechanism.

### 58. Phase 7 — evidence

Skill: `/capture-evidence` (the real LLM run requires PoC confirmation; it costs money)

Create:

- `evidence/discovery-member-lookup/`, `evidence/replay-member-lookup-success/`,
  `evidence/replay-member-lookup-not-found/`, `evidence/replay-member-lookup-injected-failure/` (`app_error`),
  `evidence/handoff-open-sub-account/`, `evidence/artifacts/member-lookup.json`.
- `evidence/README.md`: an index mapping each folder to its spec AC.

## Invariant check

- **No LLM on replay path.** `replay-engine` declares no `agent` or SDK dependency: BND006, ESLint, and the
  step-49 test. The CLI `replay` and `catalog` files carry a lint ban on `@idp/agent` (step 54). The model
  client is constructed only in `discover`.
- **Every action through policy.** `ACTION_REGISTRY` is exhaustive over `ACTION_KINDS` at the type level
  (step 14). `PolicyGuardedSurface` is the only surface handed to session, replay and agent (step 26). Human
  actions are mediated and checked before they run (step 27). `networkGuard` blocks off-allowlist origins as
  a backstop. Each kind has schema, policy, surface, replay, agent tool and recorder coverage (steps 6, 14,
  25, 33, 46, 27). `extract`, `wait` and `navigate` are not recordable from human gestures; the reason is
  stated in step 27.
- **Redact before any sink.** The `Redacted<T>` and `MaskedScreenshot` brands are the only types sinks
  accept (steps 16–17). `RunLog.create` redacts internally. Intervention requests, results and prompts are
  redacted, and prompts are placeholderized. The compiler's `assertNoConcreteValues` guards artifacts.
  Traces never enter `evidence/` (`localOnly`).
- **Business outcome ≠ failure.** The `RunResult` union has no recoverable member, and `FailureReason` has no
  business code (step 9). The catalog resolves classes explicitly (step 35), and every condition test asserts
  the exact variant (steps 35–44).
- **Checkpoints.** The schema requires a checkpoint on screen-changing kinds (step 6). The compiler refuses
  uncheckpointable steps (step 48). Replay verifies after every step, and again after a handoff before
  `reacquire` (steps 33, 34).
- **Schema is a public contract.** `schemaVersion` 1.0.0, JSON Schema export with a drift test, valid and
  invalid fixtures, and a CHANGELOG (steps 2–13). This is the first version, not a bump.
- **Synthetic data only.** `mock-bank` seeds obviously fake members, 900-range SSNs and synthetic
  credentials. `.env` stays gitignored. No public site is in any allowlist.

## Critical files

**To create**

- `packages/artifact-schema/src/{version.ts,common/*,locator/*,checkpoint/*,io/*,step/*,outcome/*,profile/*,artifact/*,result/*,control/*,evidence/*,policy/*,jsonSchema.ts}`,
  `packages/artifact-schema/{schemas/*.schema.json,fixtures/**,scripts/*,CHANGELOG.md}`
- `packages/policy/src/{actions,risk,intent,verdict,evaluate,config,redaction}/*`
- `packages/evidence/src/{runs,ids,runlog,store,manifest,errors}/*`
- `packages/surface/src/{port,playwright,locators,actions,dialogs,guard,evidence,recorder,testing,errors}/*`
- `packages/session/src/{lease,intervention,control,errors}/*`, `packages/session/src/LiveSession.ts`
- `packages/replay-engine/src/{ReplayEngine.ts,ReplayOptions.ts,params,checkpoints,outputs,result,steps,escalation,conditions,errors}/*`
- `packages/agent/src/{model,tools,observe,prompt,loop,trace,compiler}/*`, `packages/agent/src/DiscoveryRunner.ts`,
  `packages/agent/scripts/*.script.json`
- `apps/mock-bank/src/{main.ts,server.ts,router.ts,session,data,html,screens,faults,tenants,routes}/*`,
  `apps/mock-bank/README.md`
- `apps/cli/src/{main.ts,config,commands,output}/*`
- `apps/operator/src/{main.ts,server.ts,views}/*`
- `config/policy.json`, `config/apps/*.profile.json`, `config/README.md`, `artifacts/*`
- `*/vitest.functional.config.ts` for the seven packages with functional tests
- `docs/adr/0002`–`0009`, `evidence/**`

**To modify**

- `pnpm-workspace.yaml`: catalog entries for zod, playwright, the Anthropic SDK and pino.
- `package.json` (root): the new scripts.
- `turbo.json`: the `test:functional` task.
- Every touched `package.json`: runtime deps; `test:functional` scripts; the `cli` bin; the `surface`
  `./testing` export.
- Every touched `vitest.config.ts`: unit-only include.
- `eslint.config.js`: the replay-command lint ban.
- `.env.example`: the new keys.
- Every package's `CLAUDE.md` and `README.md`, root `CLAUDE.md`, `README.md`, `REPORT.md`,
  `docs/adr/README.md`, `_design/index.md`.

## Test plan

- **artifact-schema (unit):**
  - `common/*.test.ts`, `LocatorRung.test.ts`, `TargetRef.test.ts`, `Checkpoint.test.ts`;
  - `paramsSchemaFor.test.ts`, `outputsSchemaFor.test.ts`, `Step.test.ts`, `OutcomeRule.test.ts`,
    `AppProfile.test.ts`;
  - `CapabilityArtifact.test.ts` (fixtures and hashes), `RunResult.test.ts`, `InterventionRequest.test.ts`,
    `RunLogEntry.test.ts`, `RunManifest.test.ts`, `PolicyConfig.test.ts`;
  - `jsonSchema.test.ts` (the drift test). Together these cover AC3.
- **policy (unit):** `actionRegistry.test.ts`, `classifyRisk.test.ts`, `evaluateAction.test.ts` (AC9 at the
  unit level), `evaluateLanding.test.ts`, `createRedactor.test.ts` (AC12 at the unit level).
- **evidence (unit):** `RunLog.test.ts`, `EvidenceStore.test.ts`, `RunManifestWriter.test.ts`.
- **mock-bank (functional, HTTP):** `login.test.ts`, `memberFlow.test.ts`, `subAccountFlow.test.ts`,
  `faults.test.ts`, `tenantVariant.test.ts`.
- **surface:**
  - unit: `a11ySnapshot.test.ts`, `rungToLocator.test.ts`, `PolicyGuardedSurface.test.ts`,
    `mapDomEventToStep.test.ts`;
  - functional: `observe.test.ts`, `ladder.test.ts`, `actions.test.ts`, `maskedScreenshot.test.ts`,
    `recorder.test.ts` (the human path of AC9).
- **session:**
  - unit: `ControlLease.test.ts`, `LeasedSurface.test.ts`, `InterventionService.test.ts`,
    `ControlServer.test.ts`;
  - functional: `handoff.test.ts` (AC11 lease history).
- **replay-engine:**
  - unit: `ReplayEngine.test.ts` (AC8), `bindValues.test.ts`, `extractOutputs.test.ts`,
    `noLlmBoundary.test.ts` (AC5);
  - functional: `replayMemberLookup.test.ts` (AC4, tenant-B drift), `approvalAndHandoff.test.ts` (AC10,
    AC11), and `conditions/{memberNotFound,validationRejected,permissionDenied,knownDialog,slowLoad,failedLoad,sessionTimeout,unknownDialog,appError,targetAndCheckpoint}.test.ts`
    (AC6, AC7, AC13). Each asserts the exact `RunResult` variant and code, and that no raw param value
    appears in `run.jsonl`.
- **agent:**
  - unit: `ScriptedModel.test.ts`, `AnthropicModelClient.test.ts` (SDK mocked), `toolDefinitions.test.ts`,
    `formatObservation.test.ts`, `buildLocatorLadder.test.ts`, `deriveCheckpoint.test.ts`,
    `assertNoConcreteValues.test.ts`, `ArtifactCompiler.test.ts`;
  - functional: `discoveryStops.test.ts` (AC2), `discoverMemberLookup.test.ts` (the AC1 shape without an LLM).
- **cli:** unit `parseArgs.test.ts`, `loadConfig.test.ts`, `printResult.test.ts`; functional `cli.test.ts`
  (AC14 commands, and the discover → replay round trip).
- **operator:** unit `views.test.ts`; functional `console.test.ts`.
- **Real LLM:** none in any test. The only real call is the step-58 `/capture-evidence` run.

## Verification

1. `pnpm install`
2. `pnpm build`
3. `pnpm test`: unit only, with no browser, network or key.
4. `pnpm setup:browsers && pnpm test:functional`
5. `pnpm lint && pnpm format:check && pnpm typecheck`
6. Smoke, in two terminals:
   - `pnpm mock-bank`. Expected: `listening http://127.0.0.1:4010`.
   - `pnpm idp catalog --verify`. Expected: lists `member-lookup` and `open-sub-account`, hash verified.
   - `pnpm idp replay --artifact artifacts/member-lookup.json --param memberId=12345`. Expected: `success`,
     `savingsBalance` equal to the seed value, exit 0.
   - `pnpm idp replay --artifact artifacts/member-lookup.json --param memberId=99999`. Expected:
     `business_outcome` / `member_not_found`, exit 3.
   - `pnpm idp replay --artifact artifacts/member-lookup.json --param memberId=abc`. Expected: `failure` /
     `invalid_params`, exit 1, no browser actions.
   - `pnpm idp discover --model scripted:packages/agent/scripts/member-lookup.script.json --goal "look up
     member 12345 and read their current savings balance" --target http://127.0.0.1:4010/ --input
     memberId=12345 --sensitive memberId --output savingsBalance:decimal --out
     .runs/scripted-member-lookup.json`. Expected: `goal_met`, and the artifact validates.
   - `pnpm idp replay --artifact artifacts/open-sub-account.json --param memberId=12345 --attended --headed`,
     then `pnpm idp operator`. Expected: an approval request appears, Approve leads to `success` with a
     confirmation number.
7. `grep -rE "12345|Jane Sample|synthetic-pass-01" .runs/*/run.jsonl` finds nothing unmasked.

## Evidence

- `evidence/discovery-member-lookup/`: produced by `/capture-evidence discovery member-lookup`, which runs
  `pnpm idp discover --model anthropic …` (a real run, PoC confirmation required). It holds the run log with
  reasons, the redacted prompts, the manifest and the compiled artifact (AC1).
- `evidence/replay-member-lookup-success/`: `pnpm idp replay … --param memberId=12345` (AC4).
- `evidence/replay-member-lookup-not-found/`: `… --param memberId=99999` (AC6).
- `evidence/replay-member-lookup-injected-failure/`: `mock-bank` with `MOCKBANK_FAULTS=app_error`, then replay.
  It includes the masked screenshot and the a11y snapshot (AC7, AC13).
- `evidence/handoff-open-sub-account/`: an attended replay. It holds the intervention request, the lease
  history in the run log, the recorded human action and the approval (AC10, AC11).
- `evidence/artifacts/member-lookup.json`: the saved example artifact (D3).
- AC12 is verified by `/safety-review` over `evidence/` and `artifacts/`.

## Open items the spec already calls out (no plan change needed)

- Stretch goal choice for roadmap #12 (S1 or S5): after #11. `extends` and the per-tenant profiles leave room
  for either.
- Default model id and budget: the plan uses `IDP_MODEL` (default `claude-sonnet-5-5`), `maxSteps` 25 and
  `timeoutMs` 300 000, all configurable. The PoC confirms or changes them before the step-58 real run; no code
  changes.

## Risks / things to watch during execution

- **Traces vs invariant 3 (spec deviation).** FR19 and AC13 mention a Playwright trace. A trace holds full DOM
  snapshots and network bodies, which cannot be reliably redacted. The plan therefore keeps traces opt-in,
  `localOnly` under `.runs/`, and never in `evidence/`. AC13 is satisfied by the screenshot and a11y snapshot;
  the trace ref appears only with `--trace`. **The PoC should amend FR19/AC13 in `spec.md` to match.**
- **The test split changes a root rule.** `pnpm test` is now unit-only, and browser tests move to
  `pnpm test:functional`. This keeps the CLAUDE.md promise ("no browser" in `pnpm test`). But `/commit`'s gate
  and `implement-plan`'s phase gates must run `test:functional` from phase 4 on, or regressions go unseen.
  Update `.claude/commands/commit.md` if the PoC agrees.
- **Same-layer peers.** `agent` and `replay-engine` may never depend on each other: BND001 rejects any
  dependency that is not strictly to the left, devDependencies included. Anything that needs both (the
  discover → replay round trip, `--verify-replay`) lives in `apps/cli`. Implementers must not add a
  cross-peer devDependency "just for a test".
- **The Playwright aria-snapshot API for frames** (`packages/surface/src/playwright/a11ySnapshot.ts`). The API
  has changed across recent versions. Use Context7 for 1.63 and do not assume a frame-aware snapshot exists.
  The walk is per frame, merged by frame path.
- **Native dialogs hang pages** (`DialogMonitor.ts`). Once a `dialog` listener exists, Playwright no longer
  auto-dismisses, so any action while a dialog is pending blocks. `DialogPendingError` and an explicit check
  before every act are essential. The irreversible `confirm` on step 20's page must be accepted only inside
  the approved action.
- **Mediated human control** (`captureScript.ts`, `HumanActionRecorder.ts`). `preventDefault` and re-execution
  can double-fire, or miss form submits started by `onclick` handlers in legacy markup. Test with the real
  `mock-bank` inline handlers. Frames need `exposeBinding` at context level, installed before the first
  navigation.
- **Timing flakiness** (`slowLoad.test.ts`, `sessionTimeout.test.ts`, `CheckpointVerifier.ts`). Use injected
  budgets and mock-bank delays with at least 3× margin. Use the idle-expiry fault (expire on the next
  request), never a real idle timeout.
- **Screenshot masking completeness** (`captureMaskedScreenshot.ts`). Masking locators found by text can miss
  values rendered across split nodes. Also mask whole table cells in rows whose header is a known sensitive
  field, and state the limit in ADR-0009 and REPORT §6.
- **Real discovery non-determinism** (step 58). The model may take detours. Before its artifact is committed,
  the compiler's collapse and filter rules and `deriveCheckpoint` must produce a replayable artifact. The
  CLI's `--verify-replay` default (step 50) replays the artifact once and refuses to write it if the replay
  does not succeed.
- **Port collisions** in the functional tests. The launcher must pick free ports, including for the control
  server. Each package runs functional tests with `fileParallelism: false`, and turbo `test:functional` should
  run with `--concurrency=1` if collisions appear.
- **Size.** This is the whole roadmap (#02–#11) in one plan. Implement-plan's phase gates are the checkpoints.
  If time runs short, the cut line is: steps 1–44 and 50 (replay path + CLI) before the agent (steps 45–48),
  then the operator. Every core requirement still gets a thin-but-real slice.
