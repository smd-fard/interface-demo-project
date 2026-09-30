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
/**
 * Hex digests: a `sha256:<hex>` token (8+ hex characters: the run log writes a truncated `sha256:<16 hex>`), or
 * any standalone run of 32+ hex characters with at least one a–f letter (an all-digit run stays subject to
 * patterns). They are exempt from the
 * config patterns and terms (a digit run inside a digest is not a member number), but NOT from known-value
 * masking: a known sensitive value is masked wherever it appears. Since rules 1.2.0.
 */
const HEX_DIGEST = String.raw`sha256:[0-9a-fA-F]{8,}(?![0-9a-zA-Z])|(?<![0-9a-zA-Z])(?=[0-9]*[a-fA-F])[0-9a-fA-F]{32,}(?![0-9a-zA-Z])`;
/**
 * The scheme, host and port of an http(s) URL (`http://127.0.0.1:61012`): a 5-digit port is not a member number.
 * Exempt from patterns and terms like a digest (since rules 1.2.0); the path and query are not. The host must
 * hold a letter or a dot (`http://12345/` is not exempt) and userinfo (`u:12345@h`) never matches.
 */
const URL_AUTHORITY = String.raw`\bhttps?:\/\/[A-Za-z0-9-]*[A-Za-z.][A-Za-z0-9.-]*(?::\d{1,5})?(?![\d@:])`;
const PATTERN_PROTECTED = new RegExp(`${PROTECTED.source}|${HEX_DIGEST}|${URL_AUTHORITY}`, 'g');
const MIN_VALUE_LENGTH = 2;
const MAX_PASSES = 5;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A name-like known value: letters (any script) with optional spaces, `'`, `.` or `-`, and no digits. Such a
 * value matches case-insensitively and only at word boundaries, so `Ann` masks `ANN` / `ann` but never the
 * `Ann` inside `Annual` (since rules 1.2.0; the compiler's `TextGuard` is case-insensitive too).
 */
const ALPHABETIC_VALUE = /^[\p{L}][\p{L}\s'.-]*$/u;

const isAlphabeticValue = (value: string) => ALPHABETIC_VALUE.test(value);

/** `escapeRegExp` with every letter as a two-case class (`Ann` → `[Aa][Nn][Nn]`); the `g` regex has no `i` flag. */
function caseInsensitiveSource(value: string): string {
	return [...value]
		.map((char) => {
			const lower = char.toLowerCase();
			const upper = char.toUpperCase();
			return lower === upper ? escapeRegExp(char) : `[${lower}${upper}]`;
		})
		.join('');
}

/**
 * The regex source for one known value.
 *
 * - A digit edge only matches at a digit boundary, so `12345` never matches inside `8800123450`: masking that
 *   substring would leak the other digits and stop the account-number pattern from masking the whole run. A
 *   digit-only value therefore never matches inside a longer digit run, whatever its length.
 * - A name-like (alphabetic) value matches case-insensitively and at letter/digit boundaries only.
 * - Any other value (e.g. a password `hunter2-synthetic`, an id `AB12`) matches case-sensitively; its letter
 *   edges keep substring matching, which errs on the side of masking.
 */
function knownValueSource(value: string): string {
	if (isAlphabeticValue(value)) {
		return `(?<![\\p{L}\\p{N}])${caseInsensitiveSource(value)}(?![\\p{L}\\p{N}])`;
	}
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
function outsideProtected(
	text: string,
	replace: (segment: string) => string,
	protectedSpans: RegExp = PROTECTED,
): string {
	let result = '';
	let last = 0;
	for (const match of text.matchAll(protectedSpans)) {
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
 * at a digit boundary; a name-like value matches case-insensitively at word boundaries) → config patterns (in
 * order, with their mask style) → config terms (case-insensitive, any whitespace). Hex digests and URL
 * authorities (scheme, host, port) are exempt from patterns and terms, never from known values. Masks: `[REDACTED]` for a full mask, `[•••45]` for keep_last_N. Values shorter than 2 characters are ignored. Pure apart from the set
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

	// Keyed by the value, or by its lower case for an alphabetic value (matched case-insensitively).
	const known = new Map<string, { readonly value: string; readonly paramName: string | undefined }>();
	let knownRegex: RegExp | undefined;
	const keyOf = (value: string) => (isAlphabeticValue(value) ? value.toLowerCase() : value);

	function addSensitiveValue(input: SensitiveValueInput): void {
		const value = String(typeof input === 'object' ? input.value : input);
		const paramName = typeof input === 'object' ? input.paramName : undefined;
		if (value.length < MIN_VALUE_LENGTH) return;
		const key = keyOf(value);
		const existing = known.get(key);
		if (existing === undefined || paramName !== undefined) {
			known.set(key, { value: existing?.value ?? value, paramName: paramName ?? existing?.paramName });
		}
		knownRegex = new RegExp(
			[...known.values()]
				.map((entry) => entry.value)
				.sort((a, b) => b.length - a.length)
				.map(knownValueSource)
				.join('|'),
			'gu',
		);
	}
	options.sensitiveValues.forEach(addSensitiveValue);

	function pass(text: string, mode: Mode): string {
		let result = text;
		const regex = knownRegex;
		if (regex !== undefined) {
			result = outsideProtected(result, (segment) =>
				segment.replace(regex, (match) => {
					const paramName = known.get(keyOf(match))?.paramName;
					return mode === 'placeholder' && paramName !== undefined ? `{{${paramName}}}` : FULL_MASK;
				}),
			);
		}
		for (const pattern of patterns) {
			result = outsideProtected(result, (segment) => segment.replace(pattern.regex, pattern.mask), PATTERN_PROTECTED);
		}
		if (terms !== undefined) {
			result = outsideProtected(result, (segment) => segment.replace(terms, FULL_MASK), PATTERN_PROTECTED);
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
