import { describe, expect, it } from 'vitest';
import { SemverSchema } from './Semver.js';

describe('SemverSchema', () => {
	it.each(['0.0.1', '1.0.0', '10.20.30', '1.0.0-alpha.1', '1.0.0+build.5', '2.1.0-rc.1+sha.abc'])(
		'accepts %s',
		(value) => {
			expect(SemverSchema.parse(value)).toBe(value);
		},
	);

	it.each(['1', '1.0', 'v1.0.0', '01.0.0', '1.0.0-', '1.0.0 ', ''])('rejects %j', (value) => {
		expect(SemverSchema.safeParse(value).success).toBe(false);
	});
});
