import { describe, expect, it } from 'vitest';
import { FakeClock } from './FakeClock.js';
import { FakeRandom } from './FakeRandom.js';

describe('FakeClock', () => {
	it('returns a fixed time that only advance moves, as fresh Date copies', () => {
		const clock = new FakeClock(new Date('2026-09-29T10:15:00.000Z'));
		const first = clock.now();
		first.setUTCFullYear(1999);
		expect(clock.now().toISOString()).toBe('2026-09-29T10:15:00.000Z');
		clock.advance(1_500);
		expect(clock.now().toISOString()).toBe('2026-09-29T10:15:01.500Z');
	});
});

describe('FakeRandom', () => {
	it('returns scripted values in order, then a deterministic counter', () => {
		const random = new FakeRandom(['beef']);
		expect(random.hex(4)).toBe('beef');
		expect(random.hex(4)).toBe('0001');
		expect(random.hex(4)).toBe('0002');
	});
});
