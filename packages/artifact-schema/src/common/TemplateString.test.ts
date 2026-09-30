import { describe, expect, it } from 'vitest';
import { TemplateStringSchema, templatePlaceholders } from './TemplateString.js';

describe('TemplateStringSchema', () => {
	it.each(['Member Search', '/member/{{memberId}}', '{{origin}}/login', 'Balance for {{memberId}} on {{asOfDate}}'])(
		'accepts %j',
		(value) => {
			expect(TemplateStringSchema.parse(value)).toBe(value);
		},
	);

	it.each(['', '{{ memberId }}', '{{member_id}}', '{{12345}}', '{memberId}', 'a {{memberId} b', 'x }} y'])(
		'rejects %j',
		(value) => {
			expect(TemplateStringSchema.safeParse(value).success).toBe(false);
		},
	);
});

describe('templatePlaceholders', () => {
	it('lists placeholders in order, without duplicates', () => {
		expect(templatePlaceholders('{{origin}}/m/{{memberId}}?again={{memberId}}')).toEqual(['origin', 'memberId']);
	});

	it('returns an empty list for plain text', () => {
		expect(templatePlaceholders('Member Search')).toEqual([]);
	});
});
