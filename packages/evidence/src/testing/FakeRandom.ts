import type { Random } from '../time/Random.js';

/** Randomness for tests: returns the scripted values in order, then a zero-padded hex counter. */
export class FakeRandom implements Random {
	private readonly scripted: string[];
	private counter = 0;

	constructor(values: readonly string[] = []) {
		this.scripted = [...values];
	}

	hex(length: number): string {
		const next = this.scripted.shift();
		if (next !== undefined) return next;
		this.counter += 1;
		return this.counter.toString(16).padStart(length, '0').slice(-length);
	}
}
