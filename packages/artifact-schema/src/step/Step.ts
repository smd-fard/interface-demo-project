import { z } from 'zod';
import { OutputNameSchema } from '../common/Identifiers.js';
import { isValidRegExp } from '../common/isValidRegExp.js';
import { RouteSchema } from '../common/Route.js';
import { TimeoutMsSchema } from '../common/TimeoutMs.js';
import { ValueExprSchema } from '../common/ValueExpr.js';
import { CheckpointSchema } from '../checkpoint/Checkpoint.js';
import { TargetRefSchema } from '../locator/TargetRef.js';
import { SCREEN_CHANGING_KINDS, type ActionKind } from './ActionKind.js';
import { StepBaseSchema } from './StepBase.js';

const NavigateStepSchema = StepBaseSchema.extend({
	kind: z.literal('navigate'),
	route: RouteSchema,
}).describe('Load a route of the app (relative to the origin supplied at run time) in the top document.');

const ClickStepSchema = StepBaseSchema.extend({
	kind: z.literal('click'),
	target: TargetRefSchema,
}).describe('Click the target (a button, link or other control).');

const FillStepSchema = StepBaseSchema.extend({
	kind: z.literal('fill'),
	target: TargetRefSchema,
	value: ValueExprSchema.describe(
		'What to type. A param or credential reference, or a non-sensitive literal. A sensitive step refuses a literal, so no concrete PII or secret can live in the artifact (invariant 3).',
	),
	sensitive: z
		.boolean()
		.describe(
			'Whether the typed value is sensitive: it is masked in evidence and redacted in logs. Must be true for a credential and for a sensitive param.',
		),
}).describe('Replace the content of a text input with a value.');

const SelectStepSchema = StepBaseSchema.extend({
	kind: z.literal('select'),
	target: TargetRefSchema,
	option: ValueExprSchema.describe(
		'The option to choose, matched by its visible label (then its value). A param or a literal; never a credential.',
	),
}).describe('Choose an option in a dropdown/listbox.');

const PressStepSchema = StepBaseSchema.extend({
	kind: z.literal('press'),
	target: TargetRefSchema.optional().describe('Element to focus first; omitted = the currently focused element.'),
	key: z
		.enum(['Enter', 'Tab', 'Escape'])
		.describe('The key to press. Allowlisted: no free-form key chords, so a step cannot smuggle shortcuts.'),
}).describe('Press a single allowlisted key.');

const pattern = z
	.string()
	.min(1)
	.max(500)
	.refine(isValidRegExp, { message: 'pattern must be a valid regular expression' })
	.optional()
	.describe(
		'ECMAScript regular expression searched in the element text; the first capture group (or the whole match when there is none) is the raw value. Omitted = the whole normalized text.',
	);

const ExtractParseSchema = z
	.discriminatedUnion('kind', [
		z
			.strictObject({ kind: z.literal('text'), pattern })
			.describe('The normalized text (whitespace collapsed and trimmed).'),
		z
			.strictObject({ kind: z.literal('decimal'), pattern })
			.describe(
				'An exact decimal string: currency symbols, thousands separators and spaces are removed and a trailing minus or (…) becomes a leading "-". Never converted to a floating-point number.',
			),
		z
			.strictObject({ kind: z.literal('integer'), pattern })
			.describe('A safe integer: thousands separators and spaces are removed before parsing.'),
	])
	.describe('How the element text becomes the output value. The result is then validated against the OutputSpec.');

const ExtractStepSchema = StepBaseSchema.extend({
	kind: z.literal('extract'),
	target: TargetRefSchema,
	output: OutputNameSchema.describe('The declared output this step produces. Each output is extracted exactly once.'),
	parse: ExtractParseSchema,
}).describe('Read the text of the target into a declared output. Reads only: never changes the screen.');

const WaitStepSchema = StepBaseSchema.extend({
	kind: z.literal('wait'),
	until: CheckpointSchema.describe('The condition to wait for.'),
	timeoutMs: TimeoutMsSchema.describe('How long to wait before the step fails. Required: a wait is always bounded.'),
}).describe('Wait, bounded, until a condition holds (e.g. a slow page has finished loading).');

const DismissDialogStepSchema = StepBaseSchema.extend({
	kind: z.literal('dismiss_dialog'),
	match: z
		.string()
		.min(1)
		.max(500)
		.describe(
			'Text the open native dialog (alert/confirm/prompt) message must contain (normalized substring). Any other dialog is not touched.',
		),
	action: z.enum(['accept', 'dismiss']).describe('accept: OK. dismiss: Cancel/close.'),
}).describe('Close an expected native dialog that the flow always raises at this point.');

const SCREEN_CHANGING: ReadonlySet<ActionKind> = new Set(SCREEN_CHANGING_KINDS);

export const StepSchema = z
	.discriminatedUnion('kind', [
		NavigateStepSchema,
		ClickStepSchema,
		FillStepSchema,
		SelectStepSchema,
		PressStepSchema,
		ExtractStepSchema,
		WaitStepSchema,
		DismissDialogStepSchema,
	])
	.superRefine((step, ctx) => {
		if (SCREEN_CHANGING.has(step.kind) && step.checkpoint === undefined) {
			ctx.addIssue({
				code: 'custom',
				path: ['checkpoint'],
				message: `a ${step.kind} step changes the screen and must be followed by a checkpoint (invariant 5)`,
			});
		}
		if (step.kind === 'fill') {
			if (step.value.kind === 'literal' && step.sensitive) {
				ctx.addIssue({
					code: 'custom',
					path: ['value'],
					message:
						'a sensitive fill must not carry a literal value: use a {"kind":"param"} or {"kind":"credential"} reference (invariant 3)',
				});
			}
			if (step.value.kind === 'credential' && !step.sensitive) {
				ctx.addIssue({ code: 'custom', path: ['sensitive'], message: 'a credential fill must be marked sensitive' });
			}
		}
		if (step.kind === 'select' && step.option.kind === 'credential') {
			ctx.addIssue({ code: 'custom', path: ['option'], message: 'a select option must not be a credential' });
		}
	})
	.describe(
		'One deterministic step of a capability, discriminated on `kind`. Every step maps to one policy action type (invariant 2).',
	);
export type Step = z.infer<typeof StepSchema>;

/** The step variant of one kind, e.g. `StepOf<'fill'>`. */
export type StepOf<K extends ActionKind> = Extract<Step, { kind: K }>;
