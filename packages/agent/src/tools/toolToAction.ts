import type { Checkpoint, FrameScope, ValueType } from '@idp/artifact-schema';
import type { Bindings, SurfaceAction } from '@idp/surface';
import type { z } from 'zod';
import { ToolCallError } from '../errors/ToolCallError.js';
import type { ModelToolCall } from '../model/ModelMessage.js';
import type { CheckpointProposal } from './CheckpointProposal.js';
import { CREDENTIAL_PLACEHOLDERS, type CredentialField } from './credentialPlaceholders.js';
import type { ToolDecision } from './ToolDecision.js';
import { TOOL_INPUT_SCHEMAS, type AgentToolName } from './toolInputSchemas.js';
import type { ValueSource } from './ValueSource.js';

/** What `toolToAction` needs to resolve placeholders. Concrete values here never go back to the model. */
export interface ToolCallContext {
	/** The discovery run's example inputs, by param name (the values behind `{{paramName}}`). */
	readonly params: Readonly<Record<string, string>>;
	/** The params whose values are sensitive; omitted = every param is treated as sensitive. */
	readonly sensitiveParams?: ReadonlySet<string>;
	/** The sign-on credentials behind `{{credential.username}}` / `{{credential.password}}`. */
	readonly credentials?: { readonly username: string; readonly password: string };
}

const DEFAULT_WAIT_MS = 10_000;
const MIN_SENSITIVE_LENGTH = 2;
const WHOLE_PLACEHOLDER = /^\{\{([a-zA-Z][\w.]*)\}\}$/;
const ANY_PLACEHOLDER = /\{\{([^{}]*)\}\}/g;

type Input<N extends AgentToolName> = z.infer<(typeof TOOL_INPUT_SCHEMAS)[N]>;

function isToolName(name: string): name is AgentToolName {
	return Object.hasOwn(TOOL_INPUT_SCHEMAS, name);
}

function parseInput<N extends AgentToolName>(name: N, input: unknown): Input<N> {
	const result = TOOL_INPUT_SCHEMAS[name].safeParse(input);
	if (result.success) return result.data as Input<N>;
	// Issue messages name the field and the rule, never the received value (they go back to the model).
	const detail = result.error.issues
		.map((issue) => `${issue.path.length === 0 ? '(input)' : issue.path.join('.')}: ${issue.message}`)
		.join('; ');
	throw new ToolCallError('INVALID_INPUT', name, `invalid input for ${name}: ${detail}`);
}

function sensitiveValues(context: ToolCallContext): string[] {
	const values = Object.entries(context.params)
		.filter(([name]) => context.sensitiveParams?.has(name) ?? true)
		.map(([, value]) => value);
	if (context.credentials !== undefined) values.push(context.credentials.username, context.credentials.password);
	return values.filter((value) => value.length >= MIN_SENSITIVE_LENGTH);
}

/** A literal (no placeholder) must not carry a known sensitive value: the model must use the placeholder. */
function guardLiteral(tool: string, field: string, text: string, context: ToolCallContext): void {
	if (sensitiveValues(context).some((value) => text.includes(value))) {
		throw new ToolCallError(
			'SENSITIVE_LITERAL',
			tool,
			`${tool}.${field} contains a known sensitive input value; type its {{placeholder}} instead`,
		);
	}
}

/** A template (route, wait text) may use `{{paramName}}` placeholders of known params only. */
function checkTemplate(tool: string, field: string, text: string, context: ToolCallContext): void {
	for (const match of text.matchAll(ANY_PLACEHOLDER)) {
		const name = match[1] ?? '';
		if (!Object.hasOwn(context.params, name)) {
			throw new ToolCallError('UNKNOWN_PLACEHOLDER', tool, `${tool}.${field}: unknown placeholder {{${name}}}`);
		}
	}
	guardLiteral(tool, field, text.replace(ANY_PLACEHOLDER, ''), context);
}

/** Resolves a fill value or select option: a literal, or exactly one param / credential placeholder. */
function resolveValue(
	tool: string,
	field: string,
	text: string,
	context: ToolCallContext,
): { value: string; source: ValueSource; sensitive: boolean } {
	const whole = WHOLE_PLACEHOLDER.exec(text);
	if (whole === null) {
		if (text.includes('{{')) {
			throw new ToolCallError(
				'INVALID_INPUT',
				tool,
				`${tool}.${field} must be a plain literal or exactly one {{placeholder}}`,
			);
		}
		guardLiteral(tool, field, text, context);
		return { value: text, source: { kind: 'literal' }, sensitive: false };
	}
	const name = whole[1] ?? '';
	const credentialField = (Object.keys(CREDENTIAL_PLACEHOLDERS) as CredentialField[]).find(
		(key) => CREDENTIAL_PLACEHOLDERS[key] === text,
	);
	if (credentialField !== undefined) {
		if (context.credentials === undefined) {
			throw new ToolCallError(
				'UNKNOWN_PLACEHOLDER',
				tool,
				`${tool}.${field}: no credentials are configured for this run`,
			);
		}
		return {
			value: context.credentials[credentialField],
			source: { kind: 'credential', field: credentialField },
			sensitive: true,
		};
	}
	const value = Object.hasOwn(context.params, name) ? context.params[name] : undefined;
	if (value === undefined) {
		throw new ToolCallError('UNKNOWN_PLACEHOLDER', tool, `${tool}.${field}: unknown placeholder {{${name}}}`);
	}
	return { value, source: { kind: 'param', name }, sensitive: context.sensitiveParams?.has(name) ?? true };
}

function frameScope(frame: string | undefined): FrameScope | undefined {
	return frame?.split('/').map((name) => ({ kind: 'by_name' as const, name }));
}

function waitCheckpoint(input: Input<'wait'>): Checkpoint {
	const frame = frameScope(input.frame);
	switch (input.condition) {
		case 'text_present':
		case 'text_absent':
			return { kind: input.condition, text: input.text, ...(frame === undefined ? {} : { frame }) };
		case 'title_contains':
			return { kind: 'title_matches', title: input.text, match: 'contains' };
		case 'url_matches':
			return { kind: 'url_matches', route: input.text };
	}
}

function valueType(input: Input<'declare_output'>): ValueType {
	return input.type === 'decimal' ? { kind: 'decimal', scale: input.scale ?? 2 } : { kind: input.type };
}

function proposal(input: Input<'finish'>['finalCheckpoint']): CheckpointProposal {
	if (input.kind === 'element') return { kind: 'element', ref: input.ref };
	return { kind: 'text', text: input.text, ...(input.frame === undefined ? {} : { frame: input.frame.split('/') }) };
}

/**
 * Maps a model tool call to a `SurfaceAction` (actor `agent`, target by observation ref, the run's params as
 * bindings) or to a control signal. Placeholders are resolved here, at the last moment, and the source is
 * recorded for the compiler. An unknown tool or invalid input throws a `ToolCallError`, which the loop feeds
 * back to the model as an error tool result. The policy check itself happens in the guarded surface.
 */
export function toolToAction(call: ModelToolCall, context: ToolCallContext): ToolDecision {
	const name = call.name;
	if (!isToolName(name)) {
		throw new ToolCallError('UNKNOWN_TOOL', name, `unknown tool "${name.slice(0, 64)}"; use one of the listed tools`);
	}
	const base = {
		actor: 'agent' as const,
		...(Object.keys(context.params).length === 0 ? {} : { bindings: { ...context.params } as Bindings }),
	};
	const act = (reason: string, action: SurfaceAction, extra: { valueSource?: ValueSource; output?: string } = {}) =>
		({ kind: 'action', reason, action, ...extra }) satisfies ToolDecision;
	const target = (ref: string) => ({ kind: 'ref' as const, ref });

	switch (name) {
		case 'navigate': {
			const input = parseInput(name, call.input);
			checkTemplate(name, 'route', input.route, context);
			return act(input.reason, { ...base, kind: 'navigate', route: input.route });
		}
		case 'click': {
			const input = parseInput(name, call.input);
			return act(input.reason, { ...base, kind: 'click', target: target(input.ref) });
		}
		case 'fill': {
			const input = parseInput(name, call.input);
			const { value, source, sensitive } = resolveValue(name, 'value', input.value, context);
			return act(
				input.reason,
				{ ...base, kind: 'fill', target: target(input.ref), value, sensitive },
				{ valueSource: source },
			);
		}
		case 'select': {
			const input = parseInput(name, call.input);
			const { value, source } = resolveValue(name, 'option', input.option, context);
			return act(
				input.reason,
				{ ...base, kind: 'select', target: target(input.ref), option: value },
				{ valueSource: source },
			);
		}
		case 'press': {
			const input = parseInput(name, call.input);
			return act(input.reason, {
				...base,
				kind: 'press',
				key: input.key,
				...(input.ref === undefined ? {} : { target: target(input.ref) }),
			});
		}
		case 'extract': {
			const input = parseInput(name, call.input);
			return act(input.reason, { ...base, kind: 'extract', target: target(input.ref) }, { output: input.output });
		}
		case 'wait': {
			const input = parseInput(name, call.input);
			checkTemplate(name, 'text', input.text, context);
			return act(input.reason, {
				...base,
				kind: 'wait',
				until: waitCheckpoint(input),
				timeoutMs: input.timeoutMs ?? DEFAULT_WAIT_MS,
			});
		}
		case 'dismiss_dialog': {
			const input = parseInput(name, call.input);
			guardLiteral(name, 'match', input.match, context);
			return act(input.reason, { ...base, kind: 'dismiss_dialog', match: input.match, action: input.action });
		}
		case 'declare_output': {
			const input = parseInput(name, call.input);
			return {
				kind: 'declare_output',
				reason: input.reason,
				output: {
					name: input.name,
					description: input.description,
					type: valueType(input),
					sensitive: input.sensitive,
				},
			};
		}
		case 'finish': {
			const input = parseInput(name, call.input);
			if (input.finalCheckpoint.kind === 'text')
				checkTemplate(name, 'finalCheckpoint.text', input.finalCheckpoint.text, context);
			return {
				kind: 'finish',
				reason: input.reason,
				summary: input.summary,
				finalCheckpoint: proposal(input.finalCheckpoint),
			};
		}
		case 'request_help': {
			const input = parseInput(name, call.input);
			return { kind: 'request_help', reason: input.reason };
		}
	}
}
