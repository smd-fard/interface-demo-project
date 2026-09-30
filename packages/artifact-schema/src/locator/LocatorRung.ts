import { z } from 'zod';
import { TemplateStringSchema } from '../common/TemplateString.js';

const rationale = z
	.string()
	.min(1)
	.max(1000)
	.regex(/\S/)
	.describe(
		'Why this rung identifies the target robustly (R2.3): which stable property it relies on and what change would break it.',
	);

const surface = z
	.strictObject({
		web: z
			.strictObject({
				cssHint: z
					.string()
					.min(1)
					.max(500)
					.optional()
					.describe('A CSS selector recorded for diagnostics and drift reports only.'),
			})
			.optional()
			.describe('Web-surface details.'),
	})
	.optional()
	.describe(
		'Surface-tagged extras. Informational: the resolver never uses them as a primary rung, so the core rung stays expressible on a desktop surface (R7.1).',
	);

const RoleRungSchema = z
	.strictObject({
		kind: z.literal('role'),
		role: z
			.string()
			.regex(/^[a-z]+$/)
			.describe('Accessibility role, e.g. "button", "link", "textbox", "heading".'),
		name: TemplateStringSchema.optional().describe('Accessible name; may contain {{param}} placeholders.'),
		exact: z
			.boolean()
			.optional()
			.describe('true: the name must match exactly. Omitted/false: case-insensitive substring.'),
		rationale,
		surface,
	})
	.describe(
		'Most stable rung: role + accessible name from the accessibility tree, which desktop UI automation trees also expose.',
	);

const LabelRungSchema = z
	.strictObject({
		kind: z.literal('label'),
		text: TemplateStringSchema.describe('The label text associated with a form control.'),
		rationale,
		surface,
	})
	.describe('A form control found by its associated label.');

const TextRungSchema = z
	.strictObject({
		kind: z.literal('text'),
		text: TemplateStringSchema.describe('The visible text of the element.'),
		match: z.enum(['exact', 'contains']).describe('exact: whole normalized text; contains: substring.'),
		rationale,
		surface,
	})
	.describe('An element found by its visible text.');

const TableCellRelativeAnchorSchema = z
	.strictObject({
		kind: z.literal('table_cell_relative'),
		headerText: TemplateStringSchema.describe('Text of the header/label cell used as the anchor.'),
		direction: z.enum(['right', 'below']).describe('Where the target cell sits relative to the anchor cell.'),
		offset: z.int().min(1).max(20).describe('How many cells away from the anchor (1 = adjacent).'),
	})
	.describe(
		'The cell beside or below a labelled cell. Robust for nested layout tables where values have no ids or labels.',
	);

const FormRowAnchorSchema = z
	.strictObject({
		kind: z.literal('form_row'),
		labelText: TemplateStringSchema.describe('Text in the row that labels the control.'),
		control: z.enum(['input', 'select', 'button']).describe('The kind of control in that row.'),
	})
	.describe('The control in the table/form row whose label cell has the given text (unlabelled legacy forms).');

const NthInContainerAnchorSchema = z
	.strictObject({
		kind: z.literal('nth_in_container'),
		containerText: TemplateStringSchema.optional().describe(
			'Text inside the nearest container (form/table) to scope to; omitted = the whole frame document.',
		),
		element: z.enum(['input', 'select', 'button', 'link', 'cell', 'row']).describe('Kind of element to count.'),
		index: z.int().min(0).max(500).describe('0-based position among matching elements in the container.'),
	})
	.describe(
		'LAST RESORT and BRITTLE: breaks whenever an element is added or reordered. Use only when no semantic rung exists; replay reports drift when it is the rung that resolved.',
	);

const StructuralAnchorSchema = z
	.discriminatedUnion('kind', [TableCellRelativeAnchorSchema, FormRowAnchorSchema, NthInContainerAnchorSchema])
	.describe('How the target is found relative to page structure.');

const StructuralRungSchema = z
	.strictObject({
		kind: z.literal('structural'),
		anchor: StructuralAnchorSchema,
		rationale,
		surface,
	})
	.describe('An element found by its position relative to stable text in the page structure.');

export const LocatorRungSchema = z
	.discriminatedUnion('kind', [RoleRungSchema, LabelRungSchema, TextRungSchema, StructuralRungSchema])
	.describe(
		'One rung of the locator ladder. Rungs are tried in order and the first unique match wins. A visual-anchor rung (image/OCR match) is a design-only extension for non-DOM surfaces and is not part of v1.',
	);
export type LocatorRung = z.infer<typeof LocatorRungSchema>;
