import { describe, expect, it } from 'vitest';
import { ArtifactRefSchema } from './ArtifactRef.js';

const ref = { id: 'member-lookup', version: '1.0.0', contentHash: `sha256:${'0'.repeat(64)}` };

describe('ArtifactRefSchema', () => {
	it('accepts an id + version + content hash', () => {
		expect(ArtifactRefSchema.parse(ref)).toEqual(ref);
	});
	it('rejects a missing hash, a bad version and an unknown key', () => {
		const missing: Record<string, unknown> = { ...ref };
		delete missing.contentHash;
		expect(ArtifactRefSchema.safeParse(missing).success).toBe(false);
		expect(ArtifactRefSchema.safeParse({ ...ref, version: 'v1' }).success).toBe(false);
		expect(ArtifactRefSchema.safeParse({ ...ref, steps: [] }).success).toBe(false);
	});
});
