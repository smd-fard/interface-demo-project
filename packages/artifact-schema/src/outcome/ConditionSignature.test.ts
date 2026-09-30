import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConditionSignatureSchema } from './ConditionSignature.js';

const content = [{ kind: 'by_name', name: 'content' }];

const leaves = [
	{ kind: 'text_present', text: 'No records match your search criteria' },
	{ kind: 'text_present', text: 'SEC-403', frame: content },
	{ kind: 'title_matches', title: 'Server Error' },
	{ kind: 'title_matches', title: 'Server Error', frame: content },
	{ kind: 'route_matches', route: '**/login*' },
	{ kind: 'dialog_text', text: 'Scheduled maintenance' },
	{ kind: 'http_status', min: 500, max: 599 },
];

describe('ConditionSignatureSchema', () => {
	it.each(leaves)('accepts %j', (signature) => {
		expect(ConditionSignatureSchema.parse(signature)).toEqual(signature);
	});

	it('accepts any_of over leaf signatures', () => {
		const signature = { kind: 'any_of', signatures: [leaves[2], { kind: 'text_present', text: 'Runtime Error' }] };
		expect(ConditionSignatureSchema.parse(signature)).toEqual(signature);
	});

	it('rejects a nested any_of (depth 1 only) with the path to it', () => {
		const result = ConditionSignatureSchema.safeParse({
			kind: 'any_of',
			signatures: [leaves[0], { kind: 'any_of', signatures: [leaves[1]] }],
		});
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path.slice(0, 2)).toEqual(['signatures', 1]);
	});

	it('rejects an inverted or out-of-range http status range', () => {
		const inverted = ConditionSignatureSchema.safeParse({ kind: 'http_status', min: 599, max: 500 });
		expect(inverted.success).toBe(false);
		expect(inverted.error?.issues[0]?.path).toEqual(['min']);
		expect(ConditionSignatureSchema.safeParse({ kind: 'http_status', min: 500, max: 700 }).success).toBe(false);
	});

	it('rejects an unknown kind, an empty text and an unknown extra key', () => {
		expect(ConditionSignatureSchema.safeParse({ kind: 'css_present', selector: '.err' }).success).toBe(false);
		expect(ConditionSignatureSchema.safeParse({ kind: 'dialog_text', text: '' }).success).toBe(false);
		expect(ConditionSignatureSchema.safeParse({ ...leaves[0], regex: true }).success).toBe(false);
	});

	it('exports to JSON Schema', () => {
		expect(() => z.toJSONSchema(ConditionSignatureSchema)).not.toThrow();
	});
});
