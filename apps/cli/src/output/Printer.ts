import type { Redacted, Redactor } from '@idp/policy';

/** Where the printer writes (`process.stdout` / `process.stderr`, or a test buffer). */
export interface TextSink {
	write(chunk: string): unknown;
}

/**
 * The only way the CLI writes to stdout/stderr (invariant 3): every free-text line passes through every redactor
 * the printer has been given (the base redactor seeded with the env secrets, then e.g. a replay session's redactor
 * seeded with the params, credentials and outputs); structured JSON must already be `Redacted`.
 */
export class Printer {
	readonly #redactors: Redactor[];

	constructor(
		private readonly stdout: TextSink,
		private readonly stderr: TextSink,
		redactor: Redactor,
	) {
		this.#redactors = [redactor];
	}

	/** The most recent redactor (seed it with values that must never be printed). */
	get redactor(): Redactor {
		return this.#redactors[this.#redactors.length - 1] as Redactor;
	}

	/** Adds a richer redactor; lines are masked by it and by every earlier one. */
	useRedactor(redactor: Redactor): void {
		if (!this.#redactors.includes(redactor)) this.#redactors.push(redactor);
	}

	/** Masks free text with every redactor, most recent first. */
	redact(text: string): Redacted<string> {
		let masked = text;
		for (const redactor of [...this.#redactors].reverse()) masked = redactor.redactString(masked);
		return masked as Redacted<string>;
	}

	/** One redacted line on stdout. */
	line(text = ''): void {
		this.stdout.write(`${this.redact(text)}\n`);
	}

	/** One redacted line on stderr. */
	error(text: string): void {
		this.stderr.write(`${this.redact(text)}\n`);
	}

	/** Pretty JSON on stdout. The value is already redacted (structural fields verbatim, free text masked). */
	json(value: Redacted<unknown>): void {
		this.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
	}
}
