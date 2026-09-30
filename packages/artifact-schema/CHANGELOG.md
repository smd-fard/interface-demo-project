# @idp/artifact-schema — changelog

The public contract is versioned by `SCHEMA_VERSION` (semver): patch = docs only, minor = additive (a new optional
field or union member), major = breaking (a removed/renamed field, a changed meaning, a newly required field).
Every change updates `schemas/*.schema.json` (`pnpm --filter @idp/artifact-schema schemas:export`), the fixtures
and the tests, and adds an entry here with a migration note.

## Unreleased: run-log decision metadata (review-fixes FR10)

- `RunLogEntry` `decision` gains an optional `modelResponse` (`responseId`, `model`, `stopReason`, `usage`,
  `latencyMs`): ids, enums and counts only. `schemas/run-log-entry.schema.json` re-exported.
- The capability-artifact document is unchanged. `SCHEMA_VERSION` is **not** bumped yet: it is the literal every
  artifact embeds, so a minor bump would reject every existing artifact and fixture. Decide whether run-log changes
  version separately before the next release.

Migration: none (additive, optional; older logs stay valid).

## 1.0.0: initial public contract

- `CapabilityArtifact` (steps, locator ladders, frame scopes, typed params/outputs, checkpoints, outcome rules,
  provenance, content hash) and `AppProfile`.
- `RunResult`: `success | business_outcome | failure` with the closed `FailureReason` enum. No member exists for a
  recoverable condition.
- Control: `LeaseState`, `LeaseTransition`, `InterventionRequest`.
- Evidence: `EvidenceRef` (`redacted: true` literal), `RunLogEntry` (13 kinds), `RunManifest`.
- `PolicyConfig`: allowlist (origins, routes with include/exclude, action kinds), irreversible rules, redaction
  rules, approval expiry.
- JSON Schema export (`schemas/<name>.schema.json`, draft 2020-12, input shapes), guarded by a drift test.

Migration: none (first release).
