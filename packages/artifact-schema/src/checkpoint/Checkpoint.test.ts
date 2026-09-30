import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CheckpointSchema } from './Checkpoint.js';

const target = {
	description: 'Member detail heading',
	frame: [{ kind: 'by_name', name: 'content' }],
	ladder: [{ kind: 'role', role: 'heading', name: 'Member Detail', rationale: 'Page heading text is stable.' }],
};

const leaves = [
	{ kind: 'element_visible', target },
	{ kind: 'element_visible', target, timeoutMs: 15_000 },
	{ kind: 'element_absent', target },
	{ kind: 'text_present', text: 'Member {{memberId}}' },
	{ kind: 'text_present', text: 'Savings', frame: [{ kind: 'by_name', name: 'content' }] },
	{ kind: 'text_absent', text: 'Loading...' },
	{ kind: 'url_matches', route: '**/member/detail*' },
	{ kind: 'title_matches', title: 'Member Detail', match: 'contains' },
];

describe('CheckpointSchema', () => {
	it.each(leaves)('accepts %j', (checkpoint) => {
		expect(CheckpointSchema.parse(checkpoint)).toEqual(checkpoint);
	});

	it('accepts all_of with leaf checks', () => {
		const checkpoint = { kind: 'all_of', checks: [leaves[0], leaves[3]], timeoutMs: 5000 };
		expect(CheckpointSchema.parse(checkpoint)).toEqual(checkpoint);
	});

	it('rejects all_of nested inside all_of (depth 1 only)', () => {
		const result = CheckpointSchema.safeParse({
			kind: 'all_of',
			checks: [leaves[3], { kind: 'all_of', checks: [leaves[5]] }],
		});
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path.slice(0, 2)).toEqual(['checks', 1]);
	});

	it('rejects an empty all_of', () => {
		expect(CheckpointSchema.safeParse({ kind: 'all_of', checks: [] }).success).toBe(false);
	});

	it('rejects an unknown kind', () => {
		expect(CheckpointSchema.safeParse({ kind: 'screenshot_matches', image: 'a.png' }).success).toBe(false);
	});

	it('rejects a missing required field with its path', () => {
		const result = CheckpointSchema.safeParse({ kind: 'element_visible' });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['target']);
	});

	it('rejects an unknown extra key (strict) and a bad timeout', () => {
		expect(CheckpointSchema.safeParse({ kind: 'text_absent', text: 'x', regex: true }).success).toBe(false);
		expect(CheckpointSchema.safeParse({ kind: 'text_absent', text: 'x', timeoutMs: 0 }).success).toBe(false);
	});

	it('rejects a malformed template in expected text', () => {
		expect(CheckpointSchema.safeParse({ kind: 'text_present', text: 'Member {memberId}' }).success).toBe(false);
	});

	it('exports to JSON Schema', () => {
		expect(() => z.toJSONSchema(CheckpointSchema)).not.toThrow();
	});
});
