/** Extracted text could not be parsed as its declared kind. The message never echoes the (sensitive) text. */
export class OutputParseError extends Error {
	readonly code = 'OUTPUT_PARSE_FAILED' as const;

	constructor(
		readonly parseKind: 'text' | 'decimal' | 'integer',
		readonly problem: string,
	) {
		super(`extracted text is not a valid ${parseKind}: ${problem}`);
		this.name = 'OutputParseError';
	}
}
