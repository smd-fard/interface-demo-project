import { ConfigError } from '../errors/ConfigError.js';

/** The session control API port of an attended run (`IDP_CONTROL_PORT`; default 4020; `0` = ephemeral). */
export const DEFAULT_CONTROL_PORT = 4020;

/**
 * The control API port from `IDP_CONTROL_PORT` (default `DEFAULT_CONTROL_PORT`).
 * @throws ConfigError `config_invalid` when it is not a port number.
 */
export function controlPortFrom(env: Readonly<Record<string, string | undefined>>): number {
	const raw = env['IDP_CONTROL_PORT']?.trim();
	if (raw === undefined || raw === '') return DEFAULT_CONTROL_PORT;
	const port = Number(raw);
	if (!Number.isInteger(port) || port < 0 || port > 65_535) {
		throw new ConfigError('config_invalid', 'IDP_CONTROL_PORT must be a port number');
	}
	return port;
}
