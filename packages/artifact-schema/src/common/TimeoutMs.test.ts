import { describe, expect, it } from 'vitest';
import { TimeoutMsSchema } from './TimeoutMs.js';

describe('TimeoutMsSchema', () => {
	it('accepts positive integer milliseconds up to 5 minutes', () => {
		expect(TimeoutMsSchema.parse(1)).toBe(1);
		expect(TimeoutMsSchema.parse(300_000)).toBe(300_000);
	});
	it.each([0, -1, 1.5, 300_001, '1000'])('rejects %j', (v) => {
		expect(TimeoutMsSchema.safeParse(v).success).toBe(false);
	});
});
