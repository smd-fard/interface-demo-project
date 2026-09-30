import type { Clock } from '../time/Clock.js';

/** A clock for tests: fixed until `advance` moves it. `now()` returns a fresh copy. */
export class FakeClock implements Clock {
	private current: number;

	constructor(start: Date = new Date('2026-09-29T10:15:00.000Z')) {
		this.current = start.getTime();
	}

	now(): Date {
		return new Date(this.current);
	}

	advance(ms: number): void {
		this.current += ms;
	}
}
