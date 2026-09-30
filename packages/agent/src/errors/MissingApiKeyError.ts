/** `ANTHROPIC_API_KEY` is not set: the Anthropic model client cannot be constructed. */
export class MissingApiKeyError extends Error {
	readonly code = 'MISSING_API_KEY' as const;

	constructor() {
		super(
			'ANTHROPIC_API_KEY is not set; discovery with --model anthropic needs it. Replay, catalog, tests and --model scripted:<file> work without it.',
		);
		this.name = 'MissingApiKeyError';
	}
}
