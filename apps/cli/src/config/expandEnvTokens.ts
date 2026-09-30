import { ConfigError } from '../errors/ConfigError.js';

const TOKEN = /\$\{([^}]*)\}/g;

/**
 * Expands every `${VAR}` in the strings of a parsed JSON document (deeply; keys are kept) from `vars`. An unset
 * or empty variable is a {@link ConfigError} `unknown_env_var` naming the variable and the file, never a value.
 * Expanding the parsed document (not the raw text) keeps a value from injecting JSON.
 */
export function expandEnvTokens<T>(document: T, vars: Readonly<Record<string, string | undefined>>, source: string): T {
	const expand = (value: unknown): unknown => {
		if (typeof value === 'string') {
			return value.replace(TOKEN, (_match, name: string) => {
				const found = vars[name];
				if (found === undefined || found === '') {
					throw new ConfigError('unknown_env_var', `${source} uses \${${name}}, which is not set in the environment`);
				}
				return found;
			});
		}
		if (Array.isArray(value)) return value.map(expand);
		if (value !== null && typeof value === 'object') {
			return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, expand(inner)]));
		}
		return value;
	};
	return expand(document) as T;
}
