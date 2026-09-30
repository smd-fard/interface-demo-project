import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import { CliUsageError } from '../errors/CliUsageError.js';
import type { CommandSpec, ParsedValues } from './CommandSpec.js';

function isNodeError(error: unknown): error is Error & { code: string } {
	return error instanceof Error && typeof (error as { code?: unknown }).code === 'string';
}

/** The first `--flag` token of a raw argument, without any `=value` part. */
function flagName(token: string | undefined): string {
	return token?.split('=')[0] ?? '';
}

/**
 * Rewrites a `node:util` parse error in our own words: flag names only, never a value (`--flag=<value>`, a
 * positional) — a value may be sensitive.
 */
function usageMessage(error: Error & { code: string }, args: readonly string[], spec: CommandSpec): string {
	const flags = args.filter((arg) => arg.startsWith('-'));
	switch (error.code) {
		case 'ERR_PARSE_ARGS_UNKNOWN_OPTION': {
			const known = new Set(Object.keys(spec.options).flatMap((name) => [`--${name}`, `--no-${name}`]));
			const unknown = flags.map(flagName).find((flag) => !known.has(flag) && flag !== '--');
			return `unknown flag ${unknown ?? '(unrecognized)'} for "idp ${spec.name}"`;
		}
		case 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL':
			return `"idp ${spec.name}" takes flags only; an unexpected bare argument was given`;
		case 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE': {
			const name = /'(-[^']*)'/.exec(error.message)?.[1]?.split(' ')[0];
			return `flag ${name ?? ''} of "idp ${spec.name}" is missing its value, or takes none`.replace('  ', ' ');
		}
		default:
			return `invalid arguments for "idp ${spec.name}"`;
	}
}

/**
 * Parses a command's flags with `node:util` `parseArgs` (strict, no positionals). A bad command line throws a
 * {@link CliUsageError} (exit 64).
 */
export function parseCommandArgs<S extends CommandSpec>(spec: S, args: readonly string[]): ParsedValues<S> {
	const options: ParseArgsOptionsConfig = {};
	for (const [name, option] of Object.entries(spec.options)) {
		options[name] = {
			type: option.type,
			...(option.multiple === true ? { multiple: true } : {}),
			...(option.short === undefined ? {} : { short: option.short }),
			...(option.default === undefined ? {} : { default: option.default }),
		};
	}
	try {
		const { values } = parseArgs({
			args: [...args],
			options,
			strict: true,
			allowPositionals: false,
			allowNegative: true,
		});
		for (const [name, value] of Object.entries(values)) {
			// allowNegative applies to every boolean; only flags declared negatable may be turned off by --no-<flag>.
			if (value === false && spec.options[name]?.negatable !== true && args.includes(`--no-${name}`)) {
				throw new CliUsageError(`unknown flag --no-${name} for "idp ${spec.name}"`, spec.name);
			}
		}
		return values as ParsedValues<S>;
	} catch (error) {
		if (error instanceof CliUsageError) throw error;
		if (isNodeError(error) && error.code.startsWith('ERR_PARSE_ARGS')) {
			throw new CliUsageError(usageMessage(error, args, spec), spec.name);
		}
		throw error;
	}
}
