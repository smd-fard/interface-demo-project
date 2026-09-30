import { readFile } from 'node:fs/promises';
import { ScriptError } from '../errors/ScriptError.js';
import { OBSERVATION_OPEN } from '../observe/formatObservation.js';
import { parseFormattedObservation, type ObservedElement } from '../observe/parseFormattedObservation.js';
import type { ModelClient, ModelRequest } from './ModelClient.js';
import type { ModelMessage } from './ModelMessage.js';
import {
	ModelScriptSchema,
	type ModelScript,
	type ModelScriptInput,
	type ScriptStep,
	type ScriptTarget,
} from './ModelScript.js';
import type { ModelTurn } from './ModelTurn.js';

const NO_USAGE = Object.freeze({
	inputTokens: 0,
	outputTokens: 0,
	cacheReadInputTokens: 0,
	cacheCreationInputTokens: 0,
});

/** The text of a user message: its text parts and tool-result contents. */
function userText(message: ModelMessage): string {
	if (message.role !== 'user') return '';
	return message.content.map((part) => (part.kind === 'text' ? part.text : part.content)).join('\n');
}

function describeTarget(target: ScriptTarget): string {
	return JSON.stringify(target);
}

/**
 * A deterministic fake model that plays a script of tool calls, one per turn (tests, and keyless discovery
 * with `--model scripted:<file>`, FR24). It never calls a network.
 *
 * **How it sees the screen.** It reads the same thing a real model reads: the last `<observation>` block in the
 * request (the loop appends the output of `formatObservation` to a user message, as text or inside a tool
 * result). A script target `{ role, name | label, frame, nth }` is matched against that placeholderized
 * rendering and becomes the call's `ref`, so a script works only if the observation really exposes the element.
 *
 * It records every request (`requests`) so tests can assert that no raw value ever reached a prompt.
 */
export class ScriptedModel implements ModelClient {
	readonly modelId: string;
	readonly #script: ModelScript;
	readonly #turns: readonly ScriptStep[];
	/** The index in `#turns` of the first turn of each script step (for `loopFrom`). */
	readonly #stepStarts: readonly number[];
	readonly #requests: ModelRequest[] = [];
	#cursor = 0;
	#calls = 0;

	constructor(script: ModelScriptInput | ModelScript) {
		const parsed = ModelScriptSchema.safeParse(script);
		if (!parsed.success) {
			const detail = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
			throw new ScriptError('SCRIPT_INVALID', `invalid model script: ${detail.join('; ')}`);
		}
		this.#script = parsed.data;
		this.modelId = `scripted:${parsed.data.name}`;
		const turns: ScriptStep[] = [];
		const starts: number[] = [];
		for (const step of parsed.data.steps) {
			starts.push(turns.length);
			for (let count = 0; count < step.repeat; count += 1) turns.push(step);
		}
		this.#turns = turns;
		this.#stepStarts = starts;
	}

	/** Loads and validates a `*.script.json` file. */
	static async fromFile(path: string): Promise<ScriptedModel> {
		let raw: unknown;
		try {
			raw = JSON.parse(await readFile(path, 'utf8'));
		} catch (error) {
			throw new ScriptError('SCRIPT_INVALID', `cannot read model script ${path}`, { cause: error });
		}
		return new ScriptedModel(raw as ModelScriptInput);
	}

	/** Every request received so far, as independent copies. */
	get requests(): readonly ModelRequest[] {
		return this.#requests;
	}

	/** True when every scripted turn has been played (before any loop restart). */
	get done(): boolean {
		return this.#cursor >= this.#turns.length;
	}

	next(request: ModelRequest): Promise<ModelTurn> {
		this.#requests.push(structuredClone(request));
		try {
			return Promise.resolve(this.#play(request));
		} catch (error) {
			return Promise.reject(error as Error);
		}
	}

	#play(request: ModelRequest): ModelTurn {
		if (this.done) {
			if (this.#script.onExhausted === 'end_turn') {
				return { toolCalls: [], text: 'script exhausted', stopReason: 'end_turn', usage: NO_USAGE };
			}
			if (this.#script.onExhausted === 'error' || this.#stepStarts[this.#script.loopFrom] === undefined) {
				throw new ScriptError('SCRIPT_EXHAUSTED', `model script ${this.#script.name} has no step left`);
			}
			this.#cursor = this.#stepStarts[this.#script.loopFrom] ?? 0;
		}
		const step = this.#turns[this.#cursor];
		if (step === undefined)
			throw new ScriptError('SCRIPT_EXHAUSTED', `model script ${this.#script.name} has no step left`);
		this.#cursor += 1;
		this.#calls += 1;
		const input: Record<string, unknown> = { ...step.input };
		if (step.target !== undefined) input['ref'] = this.#resolve(step.target, request);
		return {
			toolCalls: [{ id: `toolu_scripted_${String(this.#calls).padStart(3, '0')}`, name: step.tool, input }],
			text: step.text ?? '',
			stopReason: 'tool_use',
			usage: NO_USAGE,
		};
	}

	#resolve(target: ScriptTarget, request: ModelRequest): string {
		if ('ref' in target) return target.ref;
		const elements = this.#latestObservation(request);
		const matches = elements.filter(
			(element) =>
				element.role === target.role &&
				(target.name === undefined || element.name === target.name) &&
				(target.label === undefined || element.label === target.label) &&
				(target.frame === undefined || element.frame.join('/') === target.frame),
		);
		const match = matches[target.nth ?? 0];
		if (match === undefined) {
			throw new ScriptError(
				'SCRIPT_TARGET_NOT_FOUND',
				`script target ${describeTarget(target)} is not in the latest observation (${matches.length} matches)`,
			);
		}
		return match.ref;
	}

	#latestObservation(request: ModelRequest): ObservedElement[] {
		for (let index = request.messages.length - 1; index >= 0; index -= 1) {
			const message = request.messages[index];
			const text = message === undefined ? '' : userText(message);
			if (text.includes(OBSERVATION_OPEN)) return parseFormattedObservation(text);
		}
		throw new ScriptError('SCRIPT_NO_OBSERVATION', 'the request carries no <observation> to resolve a script target');
	}
}
