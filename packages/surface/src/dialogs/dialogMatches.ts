import { normalizeText } from '../internal/normalizeText.js';

/**
 * Whether a dialog message matches a `dismiss_dialog` / known-dialog pattern: the normalized message contains
 * the normalized pattern (case-sensitive substring). An empty pattern matches nothing.
 */
export function dialogMatches(message: string, match: string): boolean {
	const wanted = normalizeText(match);
	return wanted.length > 0 && normalizeText(message).includes(wanted);
}
