import { ConfigError } from '../errors/ConfigError.js';

const DEFAULT_MOCKBANK_PORT = '4010';

function set(value: string | undefined): string | undefined {
	return value === undefined || value.trim() === '' ? undefined : value.trim();
}

/**
 * The value of `${MOCKBANK_ORIGIN}` in the config files: `MOCKBANK_ORIGIN` when set, else
 * `http://127.0.0.1:${MOCKBANK_PORT ?? 4010}`. An empty variable counts as unset (`.env.example` leaves them empty).
 */
export function mockBankOrigin(env: Readonly<Record<string, string | undefined>>): string {
	const explicit = set(env['MOCKBANK_ORIGIN']);
	const port = set(env['MOCKBANK_PORT']) ?? DEFAULT_MOCKBANK_PORT;
	if (explicit === undefined && !/^\d{1,5}$/.test(port)) {
		throw new ConfigError('config_invalid', 'MOCKBANK_PORT must be a port number');
	}
	const origin = explicit ?? `http://127.0.0.1:${port}`;
	if (!URL.canParse(origin) || !['http:', 'https:'].includes(new URL(origin).protocol)) {
		throw new ConfigError('config_invalid', 'MOCKBANK_ORIGIN must be an http(s) URL origin');
	}
	return new URL(origin).origin;
}
