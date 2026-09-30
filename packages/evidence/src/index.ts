// @idp/evidence — the run's sinks: run directory, redacting run log, evidence store and manifest. Every
// write accepts only redacted data (invariant 3). Test fakes live in the `@idp/evidence/testing` subpath.

// injected ports
export { type Clock, systemClock } from './time/Clock.js';
export { type Random, systemRandom } from './time/Random.js';

// ids
export { newInterventionId, newRunId } from './ids/newRunId.js';

// errors
export { EvidenceReadError } from './errors/EvidenceReadError.js';
export { EvidenceValidationError, type EvidenceIssue } from './errors/EvidenceValidationError.js';
export { EvidenceWriteError } from './errors/EvidenceWriteError.js';

// run directory
export { DEFAULT_RUNS_ROOT, RUN_FILES, RUN_SUBDIRS, RunDirectory, type RunSubdir } from './runs/RunDirectory.js';

// run log
export { RunLog } from './runlog/RunLog.js';

// evidence store
export {
	EvidenceStore,
	type EvidenceStoreOptions,
	type JsonEvidenceSubdir,
	type StoredEvidence,
} from './store/EvidenceStore.js';

// manifest, result, artifact
export { RunManifestWriter, type RunManifestWriterOptions } from './manifest/RunManifestWriter.js';
