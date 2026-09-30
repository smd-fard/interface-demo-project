import { z } from 'zod';

/**
 * The input schema of every agent tool, as zod. One source for both sides: `toolDefinitions` exports them as
 * JSON Schema for the model, and `toolToAction` validates the model's input against them.
 */

const reason = z
	.string()
	.min(1)
	.max(500)
	.describe('Why you take this action, in one sentence. Recorded as the decision for this step.');

const ref = z
	.string()
	.regex(/^e\d+$/)
	.describe('The ref of the element, e.g. "e12": the [eN] shown next to it in the latest observation.');

const value = z
	.string()
	.max(1000)
	.describe(
		'What to type: a {{paramName}} placeholder for an input value (e.g. {{memberId}}), {{credential.username}} / {{credential.password}} for the sign-on credentials, or a plain non-sensitive literal. Never type a real value you were not given as a placeholder.',
	);

const outputName = z
	.string()
	.max(64)
	.regex(/^[a-z][a-zA-Z0-9]*$/)
	.describe('A camelCase output name, e.g. "savingsBalance".');

const frame = z
	.string()
	.min(1)
	.max(200)
	.describe('The frame to look in, by name as shown in the observation (e.g. "content"); "a/b" for nested frames.');

/** The zod input schema of each agent tool, by tool name (validated strictly: unknown keys are rejected). */
export const TOOL_INPUT_SCHEMAS = {
	navigate: z.strictObject({
		route: z
			.string()
			.regex(/^\//)
			.max(500)
			.describe('A route on the application, starting with "/", e.g. "/member/search". May use {{paramName}}.'),
		reason,
	}),
	click: z.strictObject({ ref, reason }),
	fill: z.strictObject({ ref, value, reason }),
	select: z.strictObject({
		ref,
		option: z
			.string()
			.min(1)
			.max(200)
			.describe('The option label to choose, or a {{paramName}} placeholder whose value is the option.'),
		reason,
	}),
	press: z.strictObject({
		key: z.enum(['Enter', 'Tab', 'Escape']).describe('The key to press.'),
		ref: ref
			.optional()
			.describe('The element to focus first (a ref from the latest observation); omit for the focused one.'),
		reason,
	}),
	extract: z.strictObject({
		ref,
		output: outputName.describe('The declared output (see declare_output) that receives the element text.'),
		reason,
	}),
	wait: z.strictObject({
		condition: z
			.enum(['text_present', 'text_absent', 'title_contains', 'url_matches'])
			.describe('What to wait for: text shown / gone, the page title containing text, or the route matching a glob.'),
		text: z
			.string()
			.min(1)
			.max(500)
			.describe('The text, title fragment or route glob (e.g. "**/member/detail*"). May use {{paramName}}.'),
		frame: frame.optional(),
		timeoutMs: z.int().min(500).max(60_000).optional().describe('How long to wait (default 10000 ms).'),
		reason,
	}),
	dismiss_dialog: z.strictObject({
		match: z.string().min(1).max(500).describe('Text the open dialog message must contain.'),
		action: z.enum(['accept', 'dismiss']).describe('accept = OK, dismiss = Cancel.'),
		reason,
	}),
	declare_output: z.strictObject({
		name: outputName,
		type: z.enum(['string', 'integer', 'decimal', 'boolean', 'date']).describe('The value type of the output.'),
		scale: z.int().min(0).max(10).optional().describe('For decimal: the number of fractional digits (default 2).'),
		description: z.string().min(1).max(500).describe('What the value means, for a calling agent and a reviewer.'),
		sensitive: z.boolean().describe('True when the value is personal or financial data that must be redacted.'),
		reason,
	}),
	finish: z.strictObject({
		summary: z.string().min(1).max(1000).describe('What was achieved, in one or two sentences.'),
		finalCheckpoint: z
			.discriminatedUnion('kind', [
				z.strictObject({
					kind: z.literal('text'),
					text: z.string().min(1).max(500).describe('Text visible now that proves the goal is met.'),
					frame: frame.optional(),
				}),
				z.strictObject({
					kind: z.literal('element'),
					ref: ref.describe('An element visible now (a ref from the latest observation) that proves the goal is met.'),
				}),
			])
			.describe('What is on screen right now that proves the goal is met; it is verified before the run succeeds.'),
		reason,
	}),
	request_help: z.strictObject({
		reason: z.string().min(1).max(500).describe('What blocks you and what a human operator should do.'),
	}),
} as const;

/** The name of an agent tool (the eight action kinds and the three control tools). */
export type AgentToolName = keyof typeof TOOL_INPUT_SCHEMAS;
