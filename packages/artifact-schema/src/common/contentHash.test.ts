import { describe, expect, it } from 'vitest';
import { canonicalize, computeContentHash } from './contentHash.js';
import { CanonicalizationError } from './CanonicalizationError.js';

describe('canonicalize', () => {
	it('sorts object keys recursively and keeps array order', () => {
		expect(canonicalize({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'x' } })).toBe(
			'{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}',
		);
	});

	it('is independent of key insertion order', () => {
		expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
	});

	it('omits undefined properties like JSON', () => {
		expect(canonicalize({ a: undefined, b: null })).toBe('{"b":null}');
	});

	it('throws a typed error for values JSON cannot represent', () => {
		expect(() => canonicalize({ n: Number.NaN })).toThrow(CanonicalizationError);
		expect(() => canonicalize({ n: 1n })).toThrow(CanonicalizationError);
		try {
			canonicalize({ f: () => 1 });
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(CanonicalizationError);
			expect((error as CanonicalizationError).code).toBe('not_canonicalizable');
			expect((error as CanonicalizationError).path).toBe('$.f');
		}
	});
});

describe('computeContentHash', () => {
	it('returns sha256:<hex> over the canonical form', async () => {
		// sha256('{"a":1}')
		expect(await computeContentHash({ a: 1 })).toBe(
			'sha256:015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862',
		);
	});

	it('excludes the top-level contentHash field', async () => {
		const base = { id: 'member-lookup', version: '1.0.0' };
		const hashed = await computeContentHash(base);
		expect(await computeContentHash({ ...base, contentHash: hashed })).toBe(hashed);
		expect(await computeContentHash({ ...base, contentHash: 'sha256:other' })).toBe(hashed);
	});

	it('changes when content changes and ignores key order', async () => {
		expect(await computeContentHash({ a: 1, b: 2 })).toBe(await computeContentHash({ b: 2, a: 1 }));
		expect(await computeContentHash({ a: 1 })).not.toBe(await computeContentHash({ a: 2 }));
	});
});
