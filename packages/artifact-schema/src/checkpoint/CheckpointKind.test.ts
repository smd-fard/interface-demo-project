import { describe, expect, it } from 'vitest';
import { CheckpointSchema } from './Checkpoint.js';
import { CHECKPOINT_KINDS, CheckpointKindSchema } from './CheckpointKind.js';

describe('CheckpointKindSchema', () => {
	it('lists exactly the kinds of the Checkpoint union', () => {
		const unionKinds = CheckpointSchema.options.map((option) => option.shape.kind.value);
		expect([...CHECKPOINT_KINDS].sort()).toEqual([...unionKinds].sort());
	});

	it('rejects an unknown kind', () => {
		expect(CheckpointKindSchema.safeParse('pixel_match').success).toBe(false);
	});
});
