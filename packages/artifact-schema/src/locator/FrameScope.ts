import { z } from 'zod';

const ByNameHopSchema = z
	.strictObject({
		kind: z.literal('by_name'),
		name: z.string().min(1).max(200).describe('The frame/iframe `name` attribute, e.g. "content".'),
	})
	.describe(
		'Preferred hop. Legacy framesets address frames by name (target="content"), so the name is part of the app wiring and survives layout and URL changes.',
	);

const ByUrlPathHopSchema = z
	.strictObject({
		kind: z.literal('by_url_path'),
		glob: z.string().min(1).max(500).describe('Glob over the frame document URL path, e.g. "**/member/*.jsp".'),
	})
	.describe('Fallback hop for unnamed frames: matches the frame by the path of the document it shows.');

const ByTitleHopSchema = z
	.strictObject({
		kind: z.literal('by_title'),
		title: z.string().min(1).max(200).describe('The frame `title` attribute or its document title.'),
	})
	.describe('Fallback hop when neither name nor URL is stable.');

export const FrameHopSchema = z
	.discriminatedUnion('kind', [ByNameHopSchema, ByUrlPathHopSchema, ByTitleHopSchema])
	.describe('One step down the frame tree.');
export type FrameHop = z.infer<typeof FrameHopSchema>;

export const FrameScopeSchema = z
	.array(FrameHopSchema)
	.max(8)
	.describe(
		'Ordered frame path from the top document to the document that holds the target; [] means the top document. On a non-web surface this names the window/pane path instead.',
	);
export type FrameScope = z.infer<typeof FrameScopeSchema>;
