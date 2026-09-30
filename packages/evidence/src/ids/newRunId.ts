import { InterventionIdSchema, RunIdSchema, type InterventionId, type RunId, type RunKind } from '@idp/artifact-schema';
import { parseOrThrow } from '../internal/parseOrThrow.js';
import type { Clock } from '../time/Clock.js';
import type { Random } from '../time/Random.js';

/** `yyyymmddThhmmss` in UTC. */
function compactUtc(date: Date): string {
	return date.toISOString().slice(0, 19).replace(/[-:]/g, '');
}

/**
 * A new run id: `<kind>-<yyyymmddThhmmss>-<4hex>` (UTC), e.g. `replay-20260929T101500-a1b2`. It names the
 * run directory. Throws `EvidenceValidationError` if the injected randomness is not 4 lowercase hex.
 */
export function newRunId(kind: RunKind, clock: Clock, random: Random): RunId {
	return parseOrThrow(RunIdSchema, `${kind}-${compactUtc(clock.now())}-${random.hex(4)}`, 'run id');
}

/** A new intervention-request id: `ir-<yyyymmddThhmmss>-<4hex>` (UTC), e.g. `ir-20260929T101500-beef`. */
export function newInterventionId(clock: Clock, random: Random): InterventionId {
	return parseOrThrow(InterventionIdSchema, `ir-${compactUtc(clock.now())}-${random.hex(4)}`, 'intervention id');
}
