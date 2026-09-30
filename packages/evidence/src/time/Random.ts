import { randomBytes } from 'node:crypto';

/** A source of randomness for ids. Injected so ids are deterministic in tests. */
export interface Random {
	/** Returns `length` lowercase hex characters. */
	hex(length: number): string;
}

/** Cryptographic randomness from `node:crypto`. */
export const systemRandom: Random = Object.freeze({
	hex: (length: number) => randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length),
});
