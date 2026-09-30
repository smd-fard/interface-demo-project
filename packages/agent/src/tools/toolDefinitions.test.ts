import { ACTION_KINDS, ACTION_REGISTRY } from '@idp/policy';
import { describe, expect, it } from 'vitest';
import { ACTION_TOOLS, AGENT_TOOLS, CONTROL_TOOL_NAMES, agentToolSpecs } from './toolDefinitions.js';

interface JsonObjectSchema {
	type: string;
	properties: Record<string, { description?: string }>;
	required?: string[];
	additionalProperties?: boolean;
}

describe('toolDefinitions', () => {
	it('has exactly one tool per registered action kind, named after the kind (exhaustive)', () => {
		expect(Object.keys(ACTION_TOOLS).sort()).toEqual([...ACTION_KINDS].sort());
		for (const kind of Object.keys(ACTION_REGISTRY)) {
			const tools = AGENT_TOOLS.filter((tool) => tool.actionKind === kind);
			expect(tools.map((tool) => tool.name)).toEqual([kind]);
		}
	});

	it('adds the control tools, which map to no action kind', () => {
		expect(CONTROL_TOOL_NAMES).toEqual(['declare_output', 'finish', 'request_help']);
		const control = AGENT_TOOLS.filter((tool) => tool.actionKind === undefined).map((tool) => tool.name);
		expect(control).toEqual([...CONTROL_TOOL_NAMES]);
		expect(new Set(AGENT_TOOLS.map((tool) => tool.name)).size).toBe(AGENT_TOOLS.length);
	});

	it('requires a reason on every tool (FR4) and forbids unknown properties', () => {
		for (const tool of AGENT_TOOLS) {
			const schema = tool.inputSchema as unknown as JsonObjectSchema;
			expect(schema.type, tool.name).toBe('object');
			expect(schema.required, tool.name).toContain('reason');
			expect(schema.additionalProperties, tool.name).toBe(false);
			expect(schema, tool.name).not.toHaveProperty('$schema');
			expect(tool.description.length, tool.name).toBeGreaterThan(20);
		}
	});

	it('names targets by observation ref', () => {
		for (const kind of ['click', 'fill', 'select', 'extract'] as const) {
			const schema = ACTION_TOOLS[kind].inputSchema as unknown as JsonObjectSchema;
			expect(schema.required, kind).toContain('ref');
			expect(schema.properties['ref']?.description, kind).toMatch(/observation/);
		}
		const press = ACTION_TOOLS.press.inputSchema as unknown as JsonObjectSchema;
		expect(press.properties).toHaveProperty('ref');
		expect(press.required).not.toContain('ref');
	});

	it('tells the model to use placeholders for values', () => {
		const fill = ACTION_TOOLS.fill.inputSchema as unknown as JsonObjectSchema;
		expect(fill.properties['value']?.description).toMatch(/\{\{/);
		expect(fill.properties['value']?.description).toContain('{{credential.password}}');
	});

	it('exports provider-neutral specs in a stable order', () => {
		const specs = agentToolSpecs();
		expect(specs.map((spec) => spec.name)).toEqual(AGENT_TOOLS.map((tool) => tool.name));
		expect(Object.keys(specs[0] ?? {})).toEqual(['name', 'description', 'inputSchema']);
		expect(agentToolSpecs()).toEqual(specs);
	});
});
