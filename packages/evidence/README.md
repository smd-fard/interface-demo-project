# @idp/evidence

The run's sinks: run directory, redacting run log, evidence store and run manifest. Every write accepts only
redacted data (invariant 3). Rules for contributors: [CLAUDE.md](CLAUDE.md).

## Usage

```ts
import { DEFAULT_RUNS_ROOT, EvidenceStore, newRunId, RunDirectory, RunLog, RunManifestWriter, systemClock, systemRandom } from '@idp/evidence';

const runDir = await RunDirectory.create(DEFAULT_RUNS_ROOT, newRunId('replay', systemClock, systemRandom));
const log = RunLog.create(runDir, redactor); // redactor: @idp/policy Redactor
const manifest = new RunManifestWriter(runDir, { startedAt: systemClock.now() });
const store = new EvidenceStore(runDir, { onPut: (ref) => manifest.addEvidence(ref) });

log.log({ kind: 'run_started', runId: runDir.runId, at: systemClock.now().toISOString() /* … */ });
await store.putScreenshot(capture.screenshot, { label: 'member-detail' }); // MaskedScreenshot only
await manifest.writeResult(redactor.redact(result));
await manifest.writeManifest({ endedAt: systemClock.now() });
await log.close();
```

## Run directory layout

```
.runs/<runId>/                 runId = <discovery|replay>-<yyyymmddThhmmss>-<4hex> (UTC)
  run.jsonl                    RunLog: one RunLogEntry per line, seq gap-free from 1
  manifest.json                RunManifest (evidence refs, artifact ref, resultKind, redaction rules version)
  result.json                  RunResult
  artifact.json                CapabilityArtifact (discovery runs)
  screenshots/<nnnn>[-label].png   masked screenshots
  snapshots/<nnnn>.json        redacted a11y snapshots
  interventions/<name>.json    redacted intervention requests
  prompts/<name>.json          redacted LLM prompts (discovery)
  traces/<nnnn>-<file>         local-only Playwright traces (never exported)
```

## Exports

### Run directory

- `RunDirectory.create(root, runId)` / `RunDirectory.open(root, runId)` → `RunDirectory` — `runId`, `kind`,
  `path`, `logPath`, `manifestPath`, `resultPath`, `artifactPath`, `resolve(relative)`. `create` fails with
  `EvidenceWriteError` if the directory exists.
- `DEFAULT_RUNS_ROOT` (`'.runs'`), `RUN_FILES`, `RUN_SUBDIRS`, type `RunSubdir`.

### Run log

- `RunLog.create(runDir, redactor)` → `RunLog` — `log(entry: RunLogEntryInput): RunLogEntry` (redacts, assigns
  `seq`, validates, writes synchronously), `entries()`, `size`, `close()`.
- `RunLog.read(logPath)` → `RunLogEntry[]` (validates every line).

### Evidence store

- `new EvidenceStore(runDir, { onPut? })` —
  `putScreenshot(bytes: MaskedScreenshot, { label? })`, `putA11ySnapshot(tree: Redacted<unknown>)`,
  `putJson(name, document: Redacted<unknown>, subdir?: 'interventions' | 'prompts')`,
  `putLocalOnly(sourcePath)` (trace, `localOnly: true`), each → `EvidenceRef`; `get(refId)` →
  `StoredEvidence | undefined`; `list()`.
- Types `EvidenceStoreOptions`, `JsonEvidenceSubdir`, `StoredEvidence`.

### Run manifest

- `new RunManifestWriter(runDir, { startedAt, artifact?, redactionRulesVersion? })` — `addEvidence(...refs)`,
  `setArtifact(ref)`, `writeResult(result: Redacted<RunResult>)`, `writeArtifact(artifact: Redacted<CapabilityArtifact>)`
  → `ArtifactRef`, `snapshot()`, `writeManifest({ endedAt? })` → `RunManifest`.
- Type `RunManifestWriterOptions`.

### Ids and injected ports

- `newRunId(kind, clock, random)` → `RunId`; `newInterventionId(clock, random)` → `InterventionId` (`ir-…`).
- `Clock` (`now()`), `systemClock`; `Random` (`hex(length)`), `systemRandom`.

### Errors

| Class                     | `code`                  | When                                                  |
| ------------------------- | ----------------------- | ----------------------------------------------------- |
| `EvidenceValidationError` | `EVIDENCE_INVALID`      | Data fails its contract; nothing is written. `issues` |
| `EvidenceWriteError`      | `EVIDENCE_WRITE_FAILED` | A file or log line cannot be written (fs `cause`)     |
| `EvidenceReadError`       | `EVIDENCE_READ_FAILED`  | A run directory or file cannot be read (fs `cause`)   |

Type `EvidenceIssue` (`path`, `message`).

## `@idp/evidence/testing`

Test-only fakes for the injected ports; never imported by production code.

- `FakeClock(start?)` — fixed at `2026-09-29T10:15:00Z` by default; `advance(ms)`.
- `FakeRandom(values?)` — returns scripted hex values in order, then a zero-padded counter.
