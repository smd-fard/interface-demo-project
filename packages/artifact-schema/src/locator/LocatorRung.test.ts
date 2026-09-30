import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LocatorRungSchema } from './LocatorRung.js';

const rationale = 'Accessible name is the visible button label, which the vendor has not changed across releases.';

describe('LocatorRungSchema', () => {
	it.each([
		{ kind: 'role', role: 'button', name: 'Search', exact: true, rationale },
		{ kind: 'role', role: 'link', name: 'Member {{memberId}}', rationale },
		{ kind: 'role', role: 'heading', rationale },
		{ kind: 'label', text: 'Member Number', rationale },
		{ kind: 'text', text: 'Member Detail', match: 'exact', rationale },
		{ kind: 'text', text: 'Savings', match: 'contains', rationale },
		{
			kind: 'structural',
			anchor: { kind: 'table_cell_relative', headerText: 'Savings Balance', direction: 'right', offset: 1 },
			rationale,
		},
		{ kind: 'structural', anchor: { kind: 'form_row', labelText: 'Member #', control: 'input' }, rationale },
		{
			kind: 'structural',
			anchor: { kind: 'nth_in_container', containerText: 'Search', element: 'button', index: 0 },
			rationale,
		},
		{ kind: 'structural', anchor: { kind: 'nth_in_container', element: 'input', index: 2 }, rationale },
		{
			kind: 'label',
			text: 'Member Number',
			rationale,
			surface: { web: { cssHint: 'form[name=search] input[name=mbrno]' } },
		},
	])('accepts %j', (rung) => {
		expect(LocatorRungSchema.parse(rung)).toEqual(rung);
	});

	it('rejects a rung without a rationale', () => {
		const result = LocatorRungSchema.safeParse({ kind: 'label', text: 'Member Number' });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['rationale']);
	});

	it('rejects a blank rationale', () => {
		expect(LocatorRungSchema.safeParse({ kind: 'label', text: 'Member Number', rationale: '   ' }).success).toBe(false);
	});

	it('rejects an unknown rung kind (e.g. a raw css selector or a visual anchor)', () => {
		expect(LocatorRungSchema.safeParse({ kind: 'css', selector: '#btn', rationale }).success).toBe(false);
		expect(LocatorRungSchema.safeParse({ kind: 'visual', image: 'x.png', rationale }).success).toBe(false);
	});

	it('rejects an unknown structural anchor kind and a bad direction', () => {
		expect(
			LocatorRungSchema.safeParse({ kind: 'structural', anchor: { kind: 'xpath', expr: '//td' }, rationale }).success,
		).toBe(false);
		expect(
			LocatorRungSchema.safeParse({
				kind: 'structural',
				anchor: { kind: 'table_cell_relative', headerText: 'Balance', direction: 'left', offset: 1 },
				rationale,
			}).success,
		).toBe(false);
	});

	it('rejects an unknown extra key (strict), including unknown surface keys', () => {
		expect(LocatorRungSchema.safeParse({ kind: 'label', text: 'X', rationale, xpath: '//x' }).success).toBe(false);
		expect(
			LocatorRungSchema.safeParse({ kind: 'label', text: 'X', rationale, surface: { web: { xpath: '//x' } } }).success,
		).toBe(false);
	});

	it('rejects a malformed template in a name', () => {
		expect(LocatorRungSchema.safeParse({ kind: 'role', role: 'link', name: '{{ memberId }}', rationale }).success).toBe(
			false,
		);
	});

	it('exports to JSON Schema', () => {
		expect(() => z.toJSONSchema(LocatorRungSchema)).not.toThrow();
	});
});
