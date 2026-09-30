/** A source of the current time. Injected so runs, ids and timestamps are deterministic in tests. */
export interface Clock {
	now(): Date;
}

/** The real wall clock. */
export const systemClock: Clock = Object.freeze({ now: () => new Date() });
