import { z } from 'zod';
import { TemplateStringSchema } from '../common/TemplateString.js';
import { TimeoutMsSchema } from '../common/TimeoutMs.js';
import { FrameScopeSchema } from '../locator/FrameScope.js';
import { TargetRefSchema } from '../locator/TargetRef.js';

const timeoutMs = TimeoutMsSchema.optional().describe(
	'How long to wait for the checkpoint to hold before it fails; omitted = the engine default.',
);

const ElementVisibleSchema = z
	.strictObject({ kind: z.literal('element_visible'), target: TargetRefSchema, timeoutMs })
	.describe('Holds when the target resolves and is visible.');

const ElementAbsentSchema = z
	.strictObject({ kind: z.literal('element_absent'), target: TargetRefSchema, timeoutMs })
	.describe('Holds when the target does not resolve or is hidden (e.g. a spinner or dialog has gone).');

const TextPresentSchema = z
	.strictObject({
		kind: z.literal('text_present'),
		text: TemplateStringSchema.describe('Text that must appear (normalized substring match); may use {{param}}.'),
		frame: FrameScopeSchema.optional().describe('Frame to look in; omitted = any frame.'),
		timeoutMs,
	})
	.describe('Holds when the text is visible.');

const TextAbsentSchema = z
	.strictObject({
		kind: z.literal('text_absent'),
		text: TemplateStringSchema.describe('Text that must not appear (normalized substring match).'),
		frame: FrameScopeSchema.optional().describe('Frame to look in; omitted = any frame.'),
		timeoutMs,
	})
	.describe('Holds when the text is not visible.');

const UrlMatchesSchema = z
	.strictObject({
		kind: z.literal('url_matches'),
		route: TemplateStringSchema.describe(
			'Glob over the route relative to the app origin, e.g. "**/member/detail*". On a desktop surface: the screen/window identifier.',
		),
		timeoutMs,
	})
	.describe('Holds when the current route (top document, or the innermost frame for framesets) matches.');

const TitleMatchesSchema = z
	.strictObject({
		kind: z.literal('title_matches'),
		title: TemplateStringSchema.describe('Expected document/window title.'),
		match: z.enum(['exact', 'contains']).describe('exact: whole normalized title; contains: substring.'),
		timeoutMs,
	})
	.describe('Holds when the document or window title matches.');

const LEAF_CHECKPOINTS = [
	ElementVisibleSchema,
	ElementAbsentSchema,
	TextPresentSchema,
	TextAbsentSchema,
	UrlMatchesSchema,
	TitleMatchesSchema,
] as const;

// all_of takes only leaf checkpoints, so nesting depth is 1 by construction: a nested all_of fails as an unknown kind.
const LeafCheckpointSchema = z.discriminatedUnion('kind', [...LEAF_CHECKPOINTS]);

const AllOfSchema = z
	.strictObject({
		kind: z.literal('all_of'),
		checks: z
			.array(LeafCheckpointSchema)
			.min(1)
			.max(10)
			.describe('Leaf checkpoints that must all hold. all_of cannot be nested (depth 1).'),
		timeoutMs,
	})
	.describe('Holds when every listed check holds at the same time.');

export const CheckpointSchema = z
	.discriminatedUnion('kind', [...LEAF_CHECKPOINTS, AllOfSchema])
	.describe(
		'A verifiable condition on the screen. Every screen-changing step is followed by one (invariant 5): "the click did not throw" is not success. Uses signals any surface can provide.',
	);
export type Checkpoint = z.infer<typeof CheckpointSchema>;
