import type { Redacted } from './Redacted.js';
import type { RedactionConfig } from './RedactionConfig.js';
import { DEFAULT_REDACTION_CONFIG } from './defaultRedactionRules.js';

/** The mask for a fully redacted value. Idempotent and matches no pattern (no digits). */
export const FULL_MASK = '[REDACTED]';

/** A value known to be sensitive: a param or credential value, or an extracted sensitive output. */
export type SensitiveValueInput =
	| string
	| number
	| {
			readonly value: string | number;
			/** When set, `placeholderize` replaces the value with `{{paramName}}` instead of a mask. */
			readonly paramName?: string;
	  };

/** Options of {@link createRedactor}: the redaction rules and the values known to be sensitive up front. */
export interface CreateRedactorOptions {
	/** A `PolicyConfig`, a `ResolvedPolicy` or `{ redaction }`. Omitted = the default rules. */
	readonly config?: { readonly redaction: RedactionConfig };
	readonly sensitiveValues: readonly SensitiveValueInput[];
}

/** Redacts data before it reaches any sink (invariant 3). Stateful only in its set of known values. */
export interface Redactor {
	/** Deep copy of `value` with every sensitive string masked. Object keys are kept; values are masked. */
	redact<T>(value: T): Redacted<T>;
	/** `redact` for a single string. */
	redactString(text: string): Redacted<string>;
	/** Like `redact`, but known param values become `{{paramName}}` first. For LLM observations. */
	placeholderize<T>(value: T): Redacted<T>;
	/** Adds a value to the known set at run time, e.g. an extracted sensitive output. */
	addSensitiveValue(value: SensitiveValueInput): void;
}

// Masks and placeholders already in a string are never re-masked; this is what makes redaction idempotent.
const PROTECTED = /\[REDACTED\]|\[•••[^\s[\]•]{1,4}\]|\{\{[a-z][a-zA-Z0-9]*\}\}/g;
const MIN_VALUE_LENGTH = 2;
const MAX_PASSES = 5;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The regex source for one known value. A digit edge only matches at a digit boundary, so `12345` never
 * matches inside `8800123450`: masking that substring would leak the other digits and stop the
 * account-number pattern from masking the whole run. Letter edges keep substring matching.
 */
function knownValueSource(value: string): string {
	const lead = /^\d/.test(value) ? '(?<!\\d)' : '';
	const trail = /\d$/.test(value) ? '(?!\\d)' : '';
	return `${lead}${escapeRegExp(value)}${trail}`;
}

function keepLast(match: string, count: number): string {
	const tail = match.slice(-count);
	if (match.length <= count || /[\s[\]•]/.test(tail)) return FULL_MASK;
	return `[•••${tail}]`;
}

/** Applies `replace` to the parts of `text` that are not already a mask or a placeholder. */
function outsideProtected(text: string, replace: (segment: string) => string): string {
	let result = '';
	let last = 0;
	for (const match of text.matchAll(PROTECTED)) {
		result += replace(text.slice(last, match.index)) + match[0];
		last = match.index + match[0].length;
	}
	return result + replace(text.slice(last));
}

interface CompiledPattern {
	readonly regex: RegExp;
	readonly mask: (match: string) => string;
}

type Mode = 'mask' | 'placeholder';

/**
 * Creates a redactor. Masking order: exact known sensitive values (longest first; a digit edge only matches
 * at a digit boundary) → config patterns (in order, with their mask style) → config terms (case-insensitive,
 * any whitespace). Masks: `[REDACTED]` for a full mask, `[•••45]` for keep_last_N. Values shorter than 2 characters are ignored. Pure apart from the set
 * of known values that `addSensitiveValue` extends.
 */
export function createRedactor(options: CreateRedactorOptions): Redactor {
	const rules = options.config?.redaction ?? DEFAULT_REDACTION_CONFIG;
	const patterns: CompiledPattern[] = rules.patterns.map((pattern) => ({
		regex: new RegExp(pattern.regex, 'g'),
		mask:
			pattern.mask === 'full'
				? () => FULL_MASK
				: (match: string) => keepLast(match, pattern.mask === 'keep_last_2' ? 2 : 4),
	}));
	const terms =
		rules.terms.length === 0
			? undefined
			: new RegExp(
					[...rules.terms]
						.sort((a, b) => b.length - a.length)
						.map((term) => escapeRegExp(term.trim()).replace(/\s+/g, '\\s+'))
						.join('|'),
					'gi',
				);

	const known = new Map<string, string | undefined>();
	let knownRegex: RegExp | undefined;

	function addSensitiveValue(input: SensitiveValueInput): void {
		const value = String(typeof input === 'object' ? input.value : input);
		const paramName = typeof input === 'object' ? input.paramName : undefined;
		if (value.length < MIN_VALUE_LENGTH) return;
		if (!known.has(value) || paramName !== undefined) known.set(value, paramName ?? known.get(value));
		knownRegex = new RegExp(
			[...known.keys()]
				.sort((a, b) => b.length - a.length)
				.map(knownValueSource)
				.join('|'),
			'g',
		);
	}
	options.sensitiveValues.forEach(addSensitiveValue);

	function pass(text: string, mode: Mode): string {
		let result = text;
		const regex = knownRegex;
		if (regex !== undefined) {
			result = outsideProtected(result, (segment) =>
				segment.replace(regex, (match) => {
					const paramName = known.get(match);
					return mode === 'placeholder' && paramName !== undefined ? `{{${paramName}}}` : FULL_MASK;
				}),
			);
		}
		for (const pattern of patterns) {
			result = outsideProtected(result, (segment) => segment.replace(pattern.regex, pattern.mask));
		}
		if (terms !== undefined) {
			result = outsideProtected(result, (segment) => segment.replace(terms, FULL_MASK));
		}
		return result;
	}

	// Masking splits the text around masks, which can expose a new match (e.g. a \b next to a mask), so passes
	// repeat until nothing changes: the result is a fixpoint, hence idempotent.
	function text(input: string, mode: Mode): string {
		let current = input;
		for (let index = 0; index < MAX_PASSES; index += 1) {
			const next = pass(current, mode);
			if (next === current) return next;
			current = next;
		}
		return current;
	}

	function walk(value: unknown, mode: Mode, ancestors: Set<object>): unknown {
		if (typeof value === 'string') return text(value, mode);
		if (typeof value === 'number' || typeof value === 'bigint') {
			const asText = String(value);
			const masked = text(asText, mode);
			return masked === asText ? value : masked;
		}
		if (value === null || typeof value !== 'object') return value;
		if (ancestors.has(value)) return '[Circular]';
		if (value instanceof Date) return new Date(value.getTime());
		if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return FULL_MASK;
		ancestors.add(value);
		let result: unknown;
		if (Array.isArray(value)) {
			result = value.map((item: unknown) => walk(item, mode, ancestors));
		} else if (value instanceof Map) {
			result = new Map(
				[...value.entries()].map(([key, item]) => [walk(key, mode, ancestors), walk(item, mode, ancestors)]),
			);
		} else if (value instanceof Set) {
			result = new Set([...value].map((item: unknown) => walk(item, mode, ancestors)));
		} else if (value instanceof Error) {
			const copy: Record<string, unknown> = { name: value.name, message: walk(value.message, mode, ancestors) };
			if (value.stack !== undefined) copy['stack'] = walk(value.stack, mode, ancestors);
			for (const [key, item] of Object.entries(value)) copy[key] = walk(item, mode, ancestors);
			if (value.cause !== undefined) copy['cause'] = walk(value.cause, mode, ancestors);
			result = copy;
		} else {
			const copy: Record<string, unknown> = {};
			for (const [key, item] of Object.entries(value)) copy[key] = walk(item, mode, ancestors);
			result = copy;
		}
		ancestors.delete(value);
		return result;
	}

	return {
		redact: <T>(value: T) => walk(value, 'mask', new Set()) as Redacted<T>,
		redactString: (input: string) => text(input, 'mask') as Redacted<string>,
		placeholderize: <T>(value: T) => walk(value, 'placeholder', new Set()) as Redacted<T>,
		addSensitiveValue,
	};
}
