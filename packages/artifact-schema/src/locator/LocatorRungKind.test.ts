import { describe, expect, it } from 'vitest';
import { LocatorRungSchema } from './LocatorRung.js';
import { LOCATOR_RUNG_KINDS, LocatorRungKindSchema } from './LocatorRungKind.js';

describe('LocatorRungKindSchema', () => {
	it('lists exactly the kinds of the LocatorRung union', () => {
		const unionKinds = LocatorRungSchema.options.map((option) => option.shape.kind.value);
		expect([...LOCATOR_RUNG_KINDS].sort()).toEqual([...unionKinds].sort());
	});

	it('rejects an unknown kind', () => {
		expect(LocatorRungKindSchema.safeParse('css').success).toBe(false);
	});
});
