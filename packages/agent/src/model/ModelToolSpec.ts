/** A tool offered to the model: its name, what it does, and a JSON Schema (type `object`) for its input. */
export interface ModelToolSpec {
	readonly name: string;
	readonly description: string;
	readonly inputSchema: Readonly<Record<string, unknown>>;
}
