# @idp/evidence — CLAUDE.md

> Workspace: `packages/evidence` · Root rules: [../../CLAUDE.md](../../CLAUDE.md) · API: [README.md](README.md)

## Purpose

The run's sinks: the run directory, the redacting structured run log, the evidence store (screenshots,
accessibility snapshots, JSON documents, local-only traces) and the run manifest / result / artifact files
that tie them together. Every write path accepts only redacted data, so this package is where hard
invariant 3 (redact before any sink) is enforced for logs and evidence (R5.1 structured log, R5.2 failure
evidence, R4.3 redaction in `docs/requirements.md`; plan step 17 of `_design/computer-use-automation-system/plan.md`).

## Owns

- **Run directory** — `.runs/<runId>/` (`DEFAULT_RUNS_ROOT`, gitignored): `run.jsonl`, `manifest.json`,
  `result.json`, `artifact.json` and `screenshots/`, `snapshots/`, `interventions/`, `prompts/` (`traces/` is
  created on demand). `RunDirectory.create` refuses to reuse an existing directory; `resolve` refuses paths
  that could leave the run directory.
- **Run log** — `RunLog.log(entry)` redacts internally (`redactRunLogEntry`), assigns a gap-free `seq`,
  validates against `RunLogEntrySchema` and appends one JSON line through a **synchronous** pino
  (sonic-boom) file destination, so a crash never loses an acknowledged entry. Structural fields (ids,
  enums, numbers, timestamps, refs — the `STRUCTURAL_KEYS` set) are kept verbatim so masking cannot corrupt
  them; every other key, including any key added to the schema later, is redacted.
- **Evidence store** — `EvidenceStore.put*` accepts only `MaskedScreenshot` bytes and `Redacted<…>`
  documents, never overwrites, returns `EvidenceRef`s (sequential ids, sha256). Traces go through
  `putLocalOnly` and are flagged `localOnly: true`: they may hold unmasked content and are never exported.
- **Run manifest** — `RunManifestWriter` accumulates refs and writes `manifest.json` (atomically, re-writable),
  `result.json` and `artifact.json`, each validated against its `@idp/artifact-schema` contract.
- **Ids and injected ports** — `newRunId` / `newInterventionId`, `Clock` / `Random` (+ `systemClock`,
  `systemRandom`), and the `@idp/evidence/testing` subpath (`FakeClock`, `FakeRandom`).

## Never

- Never exposes a write path that takes unredacted data: the run log redacts itself; every other `put*` /
  `write*` requires a `Redacted<T>` or `MaskedScreenshot` brand from `@idp/policy`.
- Never overwrites an evidence file or reuses a run directory.
- Never imports `@idp/surface`, `@idp/session`, `@idp/replay-engine`, `@idp/agent` or any app.
- Never depends on `playwright` or `@anthropic-ai/sdk`.
- Never imports `./testing` from production code.
- Never stores real PII or real credentials — synthetic data only.

## Allowed dependencies

- `@idp/artifact-schema`, `@idp/policy`, and third-party `pino` (the run-log destination).
- Dev tools (`typescript`, `vitest`, `rimraf`, `@types/node`) are `catalog:` devDependencies;
  versions live in the root `pnpm-workspace.yaml`. `@idp/typescript-config` is a `workspace:*` devDependency.

## Enforcement

The dependency direction is enforced by `pnpm lint`: ESLint `no-restricted-imports` generated from
`tools/repo-checks/layers.json` (source imports) plus `pnpm boundaries` (manifest check, BND001–BND009).

- BND001 — may depend only on `@idp/artifact-schema` and `@idp/policy` (workspace deps).
- BND004 (`playwright` is owned by `@idp/surface`); BND005 (`@anthropic-ai/sdk` is owned by `@idp/agent`).

## Layout

```
src/
  index.ts                     barrel (public API; see README)
  runs/RunDirectory.ts         run directory layout, create/open/resolve
  runlog/RunLog.ts             the run log (pino sync destination)
  runlog/redactRunLogEntry.ts  redaction with the structural-field exceptions
  store/EvidenceStore.ts       put* APIs, refs, localOnly traces
  manifest/RunManifestWriter.ts manifest/result/artifact documents
  ids/newRunId.ts              run and intervention ids
  time/Clock.ts, time/Random.ts injected ports
  errors/                      EvidenceReadError, EvidenceValidationError, EvidenceWriteError
  internal/                    parseOrThrow, sha256, writeFileSafely (atomic / exclusive writes)
  testing/                     `@idp/evidence/testing`: FakeClock, FakeRandom
test/fixtures/tempRoot.ts      temp runs root for tests
```

Exemplars: `runlog/RunLog.ts` (a sink that redacts before writing), `store/EvidenceStore.test.ts` (sink tests
against a temp root with `FakeClock` / `FakeRandom`).

## Commands

```bash
pnpm --filter @idp/evidence build
pnpm --filter @idp/evidence typecheck
pnpm --filter @idp/evidence test
```

Lint and format are root-only (`pnpm lint`, `pnpm format:check`); there is no per-package lint script.
