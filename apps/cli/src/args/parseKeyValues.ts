import { CliUsageError } from '../errors/CliUsageError.js';

/**
 * Turns repeatable `k=v` flag values (`--param memberId=…`, `--input …`) into a record, splitting at the first
 * `=`. Errors name the flag and the key only, never a value.
 */
export function parseKeyValues(pairs: readonly string[] | undefined, flag: string): Record<string, string> {
	const record: Record<string, string> = {};
	for (const pair of pairs ?? []) {
		const at = pair.indexOf('=');
		if (at <= 0) throw new CliUsageError(`${flag} expects key=value (the key before the first "=")`);
		const key = pair.slice(0, at);
		if (Object.hasOwn(record, key)) throw new CliUsageError(`${flag}: duplicate key "${key}"`);
		record[key] = pair.slice(at + 1);
	}
	return record;
}
