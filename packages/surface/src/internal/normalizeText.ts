/** Collapses every run of whitespace (including non-breaking spaces) into one space and trims. */
export function normalizeText(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}
