import { z } from 'zod';

/**
 * A target in a script, resolved against the latest observation the scripted model was given: either a fixed
 * ref (to script a stale or wrong ref), or an element matched by role and accessible name and/or the label the
 * observation shows for unnamed inputs (`textbox (label: "Member #")`), optionally within a named frame.
 */
export const ScriptTargetSchema = z.union([
	z.strictObject({
		ref: z
			.string()
			.regex(/^e\d+$/)
			.describe('A fixed ref, used as is.'),
	}),
	z.strictObject({
		role: z.string().min(1).describe('The role shown in the observation, e.g. "textbox", "button", "cell".'),
		name: z.string().optional().describe('The accessible name, exactly as shown (placeholderized).'),
		label: z.string().optional().describe('The label shown for an unnamed input or data cell, e.g. "Member #".'),
		frame: z.string().optional().describe('The frame path by names, e.g. "content" or "outer/inner".'),
		nth: z.int().min(0).optional().describe('0-based index among the matches, in document order (default 0).'),
	}),
]);
/** A script target: a fixed ref, or a role + name/label/frame match against the latest observation. */
export type ScriptTarget = z.infer<typeof ScriptTargetSchema>;

/** One scripted turn: the tool to call, its input, an optional target (becomes `ref`) and a repeat count. */
export const ScriptStepSchema = z.strictObject({
	tool: z.string().min(1).describe('The tool to call. Any name: an unknown one scripts a wrong model.'),
	input: z.record(z.string(), z.unknown()).default({}).describe('The tool input; `ref` is set from `target`.'),
	target: ScriptTargetSchema.optional(),
	text: z.string().optional().describe('The assistant text of the turn.'),
	repeat: z.int().min(1).max(1000).default(1).describe('Play this step this many turns in a row.'),
});
/** One scripted turn, parsed (defaults applied). */
export type ScriptStep = z.infer<typeof ScriptStepSchema>;

/**
 * A model script (`*.script.json`): the tool calls the scripted model plays, one per turn. Scripts hold
 * placeholders only (`{{memberId}}`, `{{credential.password}}`), never concrete values.
 */
export const ModelScriptSchema = z.strictObject({
	scriptVersion: z.literal(1),
	name: z.string().min(1).max(64),
	description: z.string().optional(),
	steps: z.array(ScriptStepSchema).min(1),
	onExhausted: z
		.enum(['error', 'end_turn', 'loop'])
		.default('error')
		.describe('After the last step: throw, answer with no tool call, or play again from `loopFrom`.'),
	loopFrom: z.int().min(0).default(0).describe('The step index a `loop` restarts from.'),
});
/** A model script, parsed (defaults applied). */
export type ModelScript = z.infer<typeof ModelScriptSchema>;
/** A model script as written in a `*.script.json` file (before defaults). */
export type ModelScriptInput = z.input<typeof ModelScriptSchema>;
