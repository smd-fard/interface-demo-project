# @idp/artifact-schema

Zod contracts for the capability artifact, the replay result and the other public documents, with a committed
JSON Schema export. Contract version: `SCHEMA_VERSION = '1.0.0'` (see [CHANGELOG.md](CHANGELOG.md)).

Every contract is a `<Thing>Schema` (Zod) plus a `<Thing>` type (`z.infer`). Unions are discriminated on
`kind`, persisted objects are strict (unknown keys fail) and every field carries a `.describe()` that ships in
the JSON Schema.

## Usage

```ts
import { CapabilityArtifactSchema, paramsSchemaFor, RunResultSchema, type RunResult } from '@idp/artifact-schema';

const artifact = CapabilityArtifactSchema.parse(JSON.parse(text)); // throws a ZodError at the defect path
const params = paramsSchemaFor(artifact.params).parse({ memberId: '12345' }); // strict, CLI strings coerced

function describe(result: RunResult): string {
	if (result.kind === 'success') return JSON.stringify(result.outputs);
	if (result.kind === 'business_outcome') return result.code; // e.g. member_not_found, not a failure
	return `${result.reason} at ${result.step?.id ?? '-'}: expected ${result.expected}, observed ${result.observed}`;
}
RunResultSchema.parse(JSON.parse(line)); // validate a result read from outside
```

The JSON Schema files are importable as `@idp/artifact-schema/schemas/<name>.schema.json`.

## Exports

### Documents (registered in `JSON_SCHEMAS`, exported to `schemas/`)

| Export                                                    | What it is                                                                                                                                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CapabilityArtifactSchema` / `CapabilityArtifact`         | The capability: `schemaVersion`, id, version, contract prose, `params`, `outputs`, `steps`, `successCondition`, `outcomeRules`, provenance, `contentHash`. Refinements enforce declared params/outputs/placeholders, unique ids, login steps first and credential refs that match. |
| `RunResultSchema` / `RunResult`                           | `success` (outputs, drift, recoveries) \| `business_outcome` (code, message, stepId) \| `failure` (reason, step, expected, observed, evidence refs). Text fields are already redacted.                                          |
| `InterventionRequestSchema` / `InterventionRequest`       | A request for a human (`approval` or `takeover`), with context, status `open \| claimed \| resolved` and a decision.                                                                                               |
| `RunLogEntrySchema` / `RunLogEntry` / `RunLogEntryInput`  | One structured run-log line; `RUN_LOG_ENTRY_KINDS` lists the 13 kinds (`run_started`, `observation`, `decision`, `policy_verdict`, …).                                                                            |
| `RunManifestSchema` / `RunManifest`                       | The index of one run directory (run id, kind, times, artifact ref, result kind, evidence, log path, redaction rules version).                                                                                                                                     |
| `PolicyConfigSchema` / `PolicyConfig`                     | Allowlist (origins, routes with include/exclude globs, action kinds), irreversible rules (control-name patterns, routes), redaction patterns/terms, approval expiry.                                               |
| `AppProfileSchema` / `AppProfile`                         | Per vendor app and tenant variant: origin, login route, credential ref, default conditions (scoped to `any_step`) and known dialogs.                                                                                                                         |

### Parts

| Export                                                                           | What it is                                                                                                                       |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `StepSchema` / `Step` / `StepOf<K>`                                              | One step, discriminated on `kind`; a screen-changing step must carry a checkpoint; a sensitive fill never carries a literal.      |
| `StepBaseSchema` / `StepBase`                                                    | Fields every step shares (`id`, `description`, `phase`, `risk`, `checkpoint`, `timeoutMs`).                                      |
| `ACTION_KINDS`, `SCREEN_CHANGING_KINDS`, `ActionKindSchema` / `ActionKind`       | The eight action kinds (`navigate`, `click`, `fill`, `select`, `press`, `extract`, `wait`, `dismiss_dialog`) and those that change the screen. |
| `TargetRefSchema` / `TargetRef`                                                  | A target: description, frame scope and locator ladder (ordered rungs, tried in order; R2.3).                                            |
| `LocatorRungSchema` / `LocatorRung`, `LOCATOR_RUNG_KINDS`, `LocatorRungKindSchema` | One rung: `role`, `label`, `text` or `structural`.                                                                              |
| `FrameScopeSchema` / `FrameScope`, `FrameHopSchema` / `FrameHop`                 | The frame path from the top document to the target's frame.                                                                      |
| `CheckpointSchema` / `Checkpoint`, `CHECKPOINT_KINDS`, `CheckpointKindSchema`    | A verifiable condition: `element_visible`, `element_absent`, `text_present`, `text_absent`, `url_matches`, `title_matches`, `all_of`. |
| `ParamSpecSchema` / `ParamSpec`, `OutputSpecSchema` / `OutputSpec`               | Typed, optionally sensitive inputs and outputs.                                                                                  |
| `ValueTypeSchema` / `ValueType`                                                  | `string`, `integer`, `decimal` (a string with a scale), `boolean`, `enum`, `date`.                                               |
| `ValueExprSchema` / `ValueExpr`                                                  | A step value: `param` reference, `literal`, or `credential` reference — never a raw secret.                                     |
| `OutcomeRuleSchema` / `OutcomeRule`, `OutcomeScopeSchema` / `OutcomeScope`       | A runtime condition: code, class, signature, scope (steps it applies to), optional message target and recovery (recoverable only).                                                     |
| `ConditionSignatureSchema`, `ConditionClassSchema`, `RecoverySchema` (+ types)   | How a condition is detected; `business_outcome \| recoverable \| failure`; the bounded recovery (`dismiss_dialog`, `click_through`, `retry`, `reauth`). |
| `KnownDialogSchema` / `KnownDialog`                                              | An expected native dialog of an app profile.                                                                                     |
| `RUN_RESULT_KINDS`, `RunResultKindSchema`, `FAILURE_REASONS`, `FailureReasonSchema` (+ types) | The result kinds and the closed failure-reason enum (no member for a recoverable condition).                          |
| `ArtifactRefSchema` / `ArtifactRef`                                              | Id, version and content hash of the artifact a run executed.                                                                     |
| `LeaseStateSchema` / `LeaseState`, `LeaseTransitionSchema` / `LeaseTransition`   | Control lease `AGENT \| PAUSED \| HUMAN \| RESUMING \| CLOSED` and a recorded transition.                                        |
| `InterventionDecisionSchema` / `InterventionDecision`                            | `approve \| reject \| resumed \| aborted`.                                                                                       |
| `ActorSchema` / `Actor`, `OperatorActorSchema` / `OperatorActor`                 | `agent`, `replay` or `operator:<handle>` (an opaque handle, never a name).                                                                                  |
| `EvidenceRefSchema` / `EvidenceRef`, `EvidenceIdSchema`, `EvidenceKindSchema`, `RunRelativePathSchema` (+ types) | A pointer to redacted evidence (`redacted: true`) inside a run directory.                       |

### Primitives

`SchemaVersionSchema`, `SemverSchema`, the identifiers (`CapabilityIdSchema`, `StepIdSchema`, `ParamNameSchema`,
`OutputNameSchema`, `OutcomeCodeSchema`, `CredentialRefSchema`, `RunKindSchema`, `RunIdSchema`,
`InterventionIdSchema`, `ContentHashSchema`, `VendorAppIdSchema`, `TenantIdSchema`), `RiskClassSchema` +
`RISK_ORDER`, `TemplateStringSchema`, `TimeoutMsSchema`, `RouteSchema`, `OriginSchema` — each with its type.

### Functions and errors

| Export                                                   | Signature / behaviour                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `SCHEMA_VERSION`                                         | `'1.0.0'` — the only version a loader accepts.                                                                           |
| `maxRisk(first, ...rest)`                                | The highest `RiskClass`.                                                                                                 |
| `templatePlaceholders(template)`                         | The distinct `{{name}}` placeholders of a template, in first-use order.                                                  |
| `isValidRegExp(source)`                                  | Whether a string compiles as a regex.                                                                                    |
| `canonicalize(value)`                                    | Deterministic JSON (sorted keys). Throws `CanonicalizationError` (`code: 'not_canonicalizable'`).                       |
| `computeContentHash(artifact)`                           | `Promise<ContentHash>`: sha256 of the canonical artifact without `contentHash` (Web Crypto).                             |
| `paramsSchemaFor(specs)` / `outputsSchemaFor(specs)`     | Strict runtime schemas for a capability's params (CLI string coercion) and outputs. Throw `DuplicateSpecNameError`.      |
| `valueSchemaFor(type, { coerce })`                       | The runtime schema for one `ValueType` (`ScalarValue`); types `ParamValues`, `OutputValues`, `ValueSchemaOptions`.       |
| `JSON_SCHEMAS`, `toJsonSchemas()`                        | The document registry and its JSON Schema (draft 2020-12, **input** shapes; shared parts under `$defs`). Types `JsonSchemaName`, `JsonSchemaDocument`. |

## JSON Schema, fixtures and versioning

- `pnpm --filter @idp/artifact-schema schemas:export` writes `schemas/<name>.schema.json`; the drift test in
  `src/jsonSchema.test.ts` fails until the committed files match the Zod contracts. Cross-field refinements
  are Zod-only.
- `fixtures/member-lookup.artifact.json` and `fixtures/open-sub-account.artifact.json` are golden artifacts;
  `fixtures/invalid/*.json` each carry one defect. `fixtures/README.md` lists them and the mock-bank screen
  contract the fixtures replay on. After a hand edit run `pnpm --filter @idp/artifact-schema fixtures:hash`.
- Semver: patch = docs/descriptions, minor = additive, major = breaking. Every change adds a
  [CHANGELOG.md](CHANGELOG.md) entry.
