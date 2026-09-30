/**
 * The command line is wrong: an unknown flag, a missing or malformed value. Exit code 64 (EX_USAGE). The message
 * names flags only, never a flag's value (a value may be sensitive).
 */
export class CliUsageError extends Error {
	readonly code = 'usage' as const;

	constructor(
		message: string,
		/** The command the usage error is about (`null`: the top-level `idp` line). */
		readonly command: string | null = null,
	) {
		super(message);
		this.name = 'CliUsageError';
	}
}
