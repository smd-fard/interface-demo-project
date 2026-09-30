import type { CommandSpec } from '../args/CommandSpec.js';
import type { CliContext } from './CliContext.js';

/** A command module (`src/commands/<name>.ts`), loaded by `main.ts` with a dynamic `import()`. */
export interface CommandModule {
	readonly spec: CommandSpec;
	/** Runs the command; resolves to the exit code (see `EXIT`). Throws typed errors. */
	run(args: readonly string[], context: CliContext): Promise<number>;
}
