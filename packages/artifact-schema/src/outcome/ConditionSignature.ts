import { z } from 'zod';
import { FrameScopeSchema } from '../locator/FrameScope.js';

// Signatures deliberately use signals any surface has (visible text, window title, screen route, native
// dialogs, load status), never DOM selectors, so a desktop surface can evaluate the same rules (R7.1).
// Text matching is a normalized (whitespace-collapsed), case-sensitive substring: fixed wording, no regex.

const text = (what: string) => z.string().min(1).max(500).describe(what);

const TextPresentSignatureSchema = z
	.strictObject({
		kind: z.literal('text_present'),
		text: text(
			'Text that appears on the screen when the condition holds, e.g. "No records match your search criteria".',
		),
		frame: FrameScopeSchema.optional().describe('Frame to look in; omitted = any frame.'),
	})
	.describe('The condition shows a fixed message somewhere on the screen.');

const TitleMatchesSignatureSchema = z
	.strictObject({
		kind: z.literal('title_matches'),
		title: text('Text the document/window title contains, e.g. "Server Error".'),
		frame: FrameScopeSchema.optional().describe(
			'Frame whose document title is checked; omitted = the top document or any frame document.',
		),
	})
	.describe('The condition replaces the page, recognisable by its title.');

const RouteMatchesSignatureSchema = z
	.strictObject({
		kind: z.literal('route_matches'),
		route: text(
			'Glob over the route relative to the app origin, e.g. "**/login*". On a desktop surface: the screen id.',
		),
	})
	.describe('The app has moved to a known route (e.g. back to the sign-on page).');

const DialogTextSignatureSchema = z
	.strictObject({
		kind: z.literal('dialog_text'),
		text: text('Text the native dialog (alert/confirm/prompt) message contains, e.g. "Scheduled maintenance".'),
	})
	.describe('A native dialog with a known message is open.');

const HttpStatusSignatureSchema = z
	.strictObject({
		kind: z.literal('http_status'),
		min: z.int().min(100).max(599).describe('Lowest matching status, inclusive.'),
		max: z.int().min(100).max(599).describe('Highest matching status, inclusive.'),
	})
	.refine((s) => s.min <= s.max, { message: 'min must not exceed max', path: ['min'] })
	.describe(
		'The last document load (top document or frame) returned a status in the range, e.g. 500–599 for a failed load. Surfaces without HTTP report the equivalent load failure.',
	);

const LEAF_SIGNATURES = [
	TextPresentSignatureSchema,
	TitleMatchesSignatureSchema,
	RouteMatchesSignatureSchema,
	DialogTextSignatureSchema,
	HttpStatusSignatureSchema,
] as const;

// any_of takes only leaves, so nesting depth is 1 by construction: a nested any_of fails as an unknown kind.
const LeafSignatureSchema = z.discriminatedUnion('kind', [...LEAF_SIGNATURES]);

const AnyOfSignatureSchema = z
	.strictObject({
		kind: z.literal('any_of'),
		signatures: z
			.array(LeafSignatureSchema)
			.min(1)
			.max(10)
			.describe('Leaf signatures; the condition holds when at least one matches. any_of cannot be nested.'),
	})
	.describe('Any of several signals identifies the condition (e.g. a title OR a body text).');

export const ConditionSignatureSchema = z
	.discriminatedUnion('kind', [...LEAF_SIGNATURES, AnyOfSignatureSchema])
	.describe(
		'How a runtime condition is recognised from an observation, discriminated on `kind`. Evaluated deterministically by replay; no model is involved.',
	);
export type ConditionSignature = z.infer<typeof ConditionSignatureSchema>;
