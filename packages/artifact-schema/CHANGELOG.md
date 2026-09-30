# @idp/artifact-schema — changelog

The public contract is versioned by `SCHEMA_VERSION` (semver): patch = docs only, minor = additive (a new optional
field or union member), major = breaking (a removed/renamed field, a changed meaning, a newly required field).
Every change updates `schemas/*.schema.json` (`pnpm --filter @idp/artifact-schema schemas:export`), the fixtures
and the tests, and adds an entry here with a migration note.

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
