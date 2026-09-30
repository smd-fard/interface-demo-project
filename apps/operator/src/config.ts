import { OperatorConfigError } from './errors/OperatorConfigError.js';

/** The operator console's configuration, from the environment. */
export interface OperatorConfig {
	/** The session control API's base URL (`IDP_CONTROL_URL`), e.g. `http://127.0.0.1:53211`. */
	readonly controlUrl: string;
	/** The session's bearer token (`IDP_CONTROL_TOKEN`). Given only to `ControlClient`; never printed. */
	readonly controlToken: string;
	/** The console's port (`IDP_OPERATOR_PORT`, default 4030; 0 = ephemeral). */
	readonly port: number;
}

/** The console port when `IDP_OPERATOR_PORT` is unset. */
export const DEFAULT_OPERATOR_PORT = 4030;

/**
 * Reads `IDP_CONTROL_URL`, `IDP_CONTROL_TOKEN` and `IDP_OPERATOR_PORT`. Throws `OperatorConfigError` naming the
 * variable (never its value) when one is missing or invalid.
 */
export function loadOperatorConfig(env: Readonly<Record<string, string | undefined>>): OperatorConfig {
	const rawUrl = env['IDP_CONTROL_URL']?.trim() ?? '';
	if (rawUrl === '') throw new OperatorConfigError('IDP_CONTROL_URL', 'is required (the session control API URL)');
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch (cause) {
		throw new OperatorConfigError('IDP_CONTROL_URL', 'is not a valid URL', { cause });
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new OperatorConfigError('IDP_CONTROL_URL', 'must be an http(s) URL');
	}

	const controlToken = env['IDP_CONTROL_TOKEN']?.trim() ?? '';
	if (controlToken === '') throw new OperatorConfigError('IDP_CONTROL_TOKEN', 'is required (the session bearer token)');

	const rawPort = env['IDP_OPERATOR_PORT']?.trim() ?? '';
	let port = DEFAULT_OPERATOR_PORT;
	if (rawPort !== '') {
		port = /^\d{1,5}$/.test(rawPort) ? Number(rawPort) : -1;
		if (port < 0 || port > 65_535) {
			throw new OperatorConfigError('IDP_OPERATOR_PORT', 'must be an integer from 0 to 65535 (0 = ephemeral)');
		}
	}
	return { controlUrl: rawUrl, controlToken, port };
}
