import { describe, expect, it } from 'vitest';
import { asMaskedScreenshot, type MaskedScreenshot } from './MaskedScreenshot.js';

describe('asMaskedScreenshot', () => {
	it('brands the bytes without copying them', () => {
		const bytes = new Uint8Array([1, 2, 3]);
		const masked: MaskedScreenshot = asMaskedScreenshot(bytes);
		expect(masked).toBe(bytes);
		// @ts-expect-error plain bytes are not a MaskedScreenshot (compile-time guard for invariant 3)
		const unmasked: MaskedScreenshot = new Uint8Array([1]);
		expect(unmasked).toBeInstanceOf(Uint8Array);
	});
});
