import { InterventionIdSchema, RunIdSchema } from '@idp/artifact-schema';
import { describe, expect, it } from 'vitest';
import { EvidenceValidationError } from '../errors/EvidenceValidationError.js';
import { FakeClock } from '../testing/FakeClock.js';
import { FakeRandom } from '../testing/FakeRandom.js';
import { systemClock } from '../time/Clock.js';
import { systemRandom } from '../time/Random.js';
import { newInterventionId, newRunId } from './newRunId.js';

describe('newRunId', () => {
	it('formats <kind>-<yyyymmddThhmmss>-<4hex> in UTC from the injected clock and randomness', () => {
		const clock = new FakeClock(new Date('2026-09-29T10:15:07.999Z'));
		expect(newRunId('replay', clock, new FakeRandom(['a1b2']))).toBe('replay-20260929T101507-a1b2');
		expect(newRunId('discovery', clock, new FakeRandom(['00ff']))).toBe('discovery-20260929T101507-00ff');
	});

	it('uses UTC, not the local time zone', () => {
		const clock = new FakeClock(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)));
		expect(newRunId('replay', clock, new FakeRandom(['beef']))).toBe('replay-20260102T030405-beef');
	});

	it('rejects randomness that is not 4 lowercase hex characters', () => {
		const clock = new FakeClock();
		expect(() => newRunId('replay', clock, new FakeRandom(['XYZ1']))).toThrow(EvidenceValidationError);
	});

	it('produces ids that validate with RunIdSchema using the system clock and randomness', () => {
		const id = newRunId('discovery', systemClock, systemRandom);
		expect(RunIdSchema.safeParse(id).success).toBe(true);
	});
});

describe('newInterventionId', () => {
	it('formats ir-<yyyymmddThhmmss>-<4hex>', () => {
		const clock = new FakeClock(new Date('2026-09-29T10:15:00Z'));
		const id = newInterventionId(clock, new FakeRandom(['beef']));
		expect(id).toBe('ir-20260929T101500-beef');
		expect(InterventionIdSchema.safeParse(id).success).toBe(true);
	});
});

describe('systemRandom', () => {
	it('returns n lowercase hex characters', () => {
		for (const n of [1, 4, 7, 32]) expect(systemRandom.hex(n)).toMatch(new RegExp(`^[0-9a-f]{${n}}$`));
	});
});
