/**
 * Decides whether a UI text may be written into an artifact as a locator or checkpoint text. The compiler
 * only ever writes text a guard accepts, so a concrete value can never become a locator (invariant 3).
 */
export type TextGuard = (text: string) => boolean;

const MASK = /\[REDACTED\]|\[•••/;
const MIN_VALUE_LENGTH = 2;

/** Whether `value` occurs in `text`: case-insensitive; a digit edge matches only at a digit boundary. */
export function containsValue(text: string, value: string): boolean {
	const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const lead = /^\d/.test(value) ? '(?<!\\d)' : '';
	const trail = /\d$/.test(value) ? '(?!\\d)' : '';
	return new RegExp(`${lead}${escaped}${trail}`, 'i').test(text);
}

/**
 * The default guard: rejects empty text, text with a redaction mask (`[REDACTED]`, `[•••45]`), braces (a
 * placeholder or template syntax), and text containing any of `sensitiveValues` (example inputs, credentials,
 * extracted values; values shorter than 2 characters are ignored).
 */
export function createTextGuard(sensitiveValues: readonly string[] = []): TextGuard {
	const values = sensitiveValues.map((value) => value.trim()).filter((value) => value.length >= MIN_VALUE_LENGTH);
	return (text) =>
		text.trim() !== '' && !MASK.test(text) && !/[{}]/.test(text) && !values.some((value) => containsValue(text, value));
}
