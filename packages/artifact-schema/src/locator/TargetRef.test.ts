import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { TargetRefSchema } from './TargetRef.js';

const rung = (text: string) => ({ kind: 'label', text, rationale: 'Visible field label next to the input.' });

const valid = {
	description: 'Member number input in the member search form',
	frame: [{ kind: 'by_name', name: 'content' }],
	ladder: [
		rung('Member Number'),
		{
			kind: 'structural',
			anchor: { kind: 'form_row', labelText: 'Member Number', control: 'input' },
			rationale: 'Legacy form rows put the label cell left of the control cell.',
		},
	],
};

describe('TargetRefSchema', () => {
	it('accepts a described target with a frame path and a ladder', () => {
		expect(TargetRefSchema.parse(valid)).toEqual(valid);
	});

	it('accepts a target in the top document', () => {
		expect(TargetRefSchema.parse({ ...valid, frame: [] }).frame).toEqual([]);
	});

	it('rejects an empty ladder and a ladder longer than 5', () => {
		expect(TargetRefSchema.safeParse({ ...valid, ladder: [] }).success).toBe(false);
		const six = Array.from({ length: 6 }, (_, i) => rung(`Label ${i}`));
		expect(TargetRefSchema.safeParse({ ...valid, ladder: six }).success).toBe(false);
	});

	it('rejects a missing description or frame', () => {
		const noDescription: Record<string, unknown> = { ...valid };
		delete noDescription.description;
		const noFrame: Record<string, unknown> = { ...valid };
		delete noFrame.frame;
		expect(TargetRefSchema.safeParse(noDescription).success).toBe(false);
		expect(TargetRefSchema.safeParse(noFrame).success).toBe(false);
	});

	it('reports the path of an invalid rung', () => {
		const result = TargetRefSchema.safeParse({ ...valid, ladder: [rung('A'), { kind: 'label', text: 'B' }] });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['ladder', 1, 'rationale']);
	});

	it('rejects an unknown extra key (strict)', () => {
		expect(TargetRefSchema.safeParse({ ...valid, selector: '#mbrno' }).success).toBe(false);
	});

	it('exports to JSON Schema', () => {
		expect(() => z.toJSONSchema(TargetRefSchema)).not.toThrow();
	});
});
