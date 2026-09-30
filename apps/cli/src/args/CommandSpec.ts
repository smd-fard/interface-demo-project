/** One flag of a command. `--help` is printed from these, so the help always shows the real flags. */
export interface OptionSpec {
	readonly type: 'string' | 'boolean';
	readonly multiple?: boolean;
	readonly short?: string;
	/** Booleans only: `--no-<flag>` turns it off. */
	readonly negatable?: boolean;
	readonly default?: string | boolean;
	/** Shown as `--flag <valueName>` (strings). */
	readonly valueName?: string;
	readonly description: string;
}

/** A command's flags, usage line and examples. */
export interface CommandSpec {
	readonly name: string;
	readonly summary: string;
	readonly usage: string;
	readonly options: Readonly<Record<string, OptionSpec>>;
	readonly examples?: readonly string[];
	/** Extra paragraphs printed after the flags (exit codes, paths, env). */
	readonly notes?: readonly string[];
}

/** The parsed values of a command's flags. */
export type ParsedValues<S extends CommandSpec> = {
	[K in keyof S['options']]: S['options'][K] extends { readonly type: 'boolean' }
		? S['options'][K] extends { readonly default: boolean }
			? boolean
			: boolean | undefined
		: S['options'][K] extends { readonly multiple: true }
			? string[] | undefined
			: S['options'][K] extends { readonly default: string }
				? string
				: string | undefined;
};
