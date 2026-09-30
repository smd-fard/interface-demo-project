import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FrameScopeSchema } from './FrameScope.js';

describe('FrameScopeSchema', () => {
	it('accepts the top document as an empty path', () => {
		expect(FrameScopeSchema.parse([])).toEqual([]);
	});

	it('accepts an ordered path of hops of every kind', () => {
		const path = [
			{ kind: 'by_name', name: 'main' },
			{ kind: 'by_url_path', glob: '**/member/*.jsp' },
			{ kind: 'by_title', title: 'Member Detail' },
		];
		expect(FrameScopeSchema.parse(path)).toEqual(path);
	});

	it('rejects an unknown hop kind with the path to it', () => {
		const result = FrameScopeSchema.safeParse([
			{ kind: 'by_name', name: 'main' },
			{ kind: 'by_index', index: 1 },
		]);
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual([1, 'kind']);
	});

	it('rejects an empty frame name and an unknown extra key', () => {
		expect(FrameScopeSchema.safeParse([{ kind: 'by_name', name: '' }]).success).toBe(false);
		expect(FrameScopeSchema.safeParse([{ kind: 'by_name', name: 'main', css: 'frame' }]).success).toBe(false);
	});

	it('exports to JSON Schema', () => {
		expect(() => z.toJSONSchema(FrameScopeSchema)).not.toThrow();
	});
});
