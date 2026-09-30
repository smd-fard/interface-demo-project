import type { ActionKind } from '@idp/artifact-schema';
import { z } from 'zod';
import type { ModelToolSpec } from '../model/ModelToolSpec.js';
import { TOOL_INPUT_SCHEMAS, type AgentToolName } from './toolInputSchemas.js';

/** A tool the discovery model can call. Action tools map to exactly one registered action kind (invariant 2). */
export interface AgentToolDefinition extends ModelToolSpec {
	readonly name: AgentToolName;
	/** The action kind (and so the policy entry) this tool performs; `undefined` for a control tool. */
	readonly actionKind: ActionKind | undefined;
}

function jsonSchema(name: AgentToolName): Readonly<Record<string, unknown>> {
	// The model API takes a plain object schema; the `$schema` dialect key is noise there.
	const schema = { ...(z.toJSONSchema(TOOL_INPUT_SCHEMAS[name]) as Record<string, unknown>) };
	delete schema['$schema'];
	return Object.freeze(schema);
}

function tool(name: AgentToolName, actionKind: ActionKind | undefined, description: string): AgentToolDefinition {
	return Object.freeze({ name, description, inputSchema: jsonSchema(name), actionKind });
}

/**
 * One tool per action kind (touch point 5 of define-action), named after the kind. The `satisfies` clause makes a
 * kind without a tool a compile error. Targets are observation refs; the compiler turns them into locator
 * ladders from the element fingerprints the surface records.
 */
export const ACTION_TOOLS = Object.freeze({
	navigate: tool(
		'navigate',
		'navigate',
		'Load a route of the application in the top window. Use it only to open the entry page or when no link leads there.',
	),
	click: tool(
		'click',
		'click',
		'Click an element (button, link, cell) identified by its ref in the latest observation.',
	),
	fill: tool(
		'fill',
		'fill',
		'Replace the text of an input identified by its ref. Type input values and credentials only as placeholders.',
	),
	select: tool('select', 'select', 'Choose an option of a dropdown (combobox/listbox) identified by its ref.'),
	press: tool('press', 'press', 'Press Enter, Tab or Escape, optionally on an element identified by its ref.'),
	extract: tool(
		'extract',
		'extract',
		'Read the text of an element identified by its ref into a declared output. Declare the output first.',
	),
	wait: tool(
		'wait',
		'wait',
		'Wait until a text appears or disappears, the title contains a text, or the route matches, before acting again.',
	),
	dismiss_dialog: tool(
		'dismiss_dialog',
		'dismiss_dialog',
		'Accept or dismiss the open native dialog (alert/confirm) shown under "dialog:" in the observation.',
	),
} satisfies Record<ActionKind, AgentToolDefinition>);

/** The control tools: they steer the run and perform no action on the application. */
export const CONTROL_TOOL_NAMES = Object.freeze(['declare_output', 'finish', 'request_help'] as const);
/** The name of a control tool (`declare_output`, `finish`, `request_help`). */
export type ControlToolName = (typeof CONTROL_TOOL_NAMES)[number];

const CONTROL_TOOLS: readonly AgentToolDefinition[] = [
	tool(
		'declare_output',
		undefined,
		'Declare an output the capability returns (name, type, whether it is sensitive) before extracting it.',
	),
	tool(
		'finish',
		undefined,
		'Finish when the goal is visibly met on the current screen. Give a checkpoint that proves it; it is verified.',
	),
	tool(
		'request_help',
		undefined,
		'Ask a human operator for help when you are blocked (unexpected screen, missing data, a decision you may not make).',
	),
];

/** Every agent tool in a fixed order (action kinds in ACTION_KINDS order, then the control tools). */
export const AGENT_TOOLS: readonly AgentToolDefinition[] = Object.freeze([
	...Object.values(ACTION_TOOLS),
	...CONTROL_TOOLS,
]);

/** The tools as provider-neutral model specs, in the stable order that keeps the prompt cache warm. */
export function agentToolSpecs(): ModelToolSpec[] {
	return AGENT_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}
