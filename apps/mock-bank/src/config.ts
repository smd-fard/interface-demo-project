import { ConfigError } from './errors/ConfigError.js';
import { parseFaultList, type FaultSpec } from './faults/parseFaultSpec.js';
import { parseTenantId, type TenantId } from './tenants/tenants.js';

/** Everything the server needs. `loadConfig` builds it from the environment. */
export interface MockBankConfig {
	readonly host: string;
	/** 0 = an ephemeral port. */
	readonly port: number;
	readonly tenant: TenantId;
	/** Session idle timeout in ms. */
	readonly sessionIdleMs: number;
	/** Default `slow_load` delay in ms. */
	readonly slowMs: number;
	/** Faults armed at start (and re-armed by `POST /__admin/reset`). */
	readonly faults: readonly FaultSpec[];
	/** Injectable clock for the session store (ms since epoch). */
	readonly now?: () => number;
}

/** The defaults `loadConfig` and `createMockBankServer` fall back to (port 4010, tenant `a`, 15 min idle, 3 s slow load). */
export const DEFAULT_CONFIG: MockBankConfig = {
	host: '127.0.0.1',
	port: 4010,
	tenant: 'a',
	sessionIdleMs: 15 * 60 * 1000,
	slowMs: 3000,
	faults: [],
};

/**
 * Reads `MOCKBANK_HOST`, `MOCKBANK_PORT`, `MOCKBANK_TENANT`, `MOCKBANK_SESSION_IDLE_MS`, `MOCKBANK_SLOW_MS`
 * and `MOCKBANK_FAULTS`. Throws `ConfigError` / `FaultSpecError` on malformed values.
 */
export function loadConfig(env: NodeJS.ProcessEnv): MockBankConfig {
	return {
		host: nonEmpty(env.MOCKBANK_HOST) ?? DEFAULT_CONFIG.host,
		port: intVar(env, 'MOCKBANK_PORT', DEFAULT_CONFIG.port, 65535),
		tenant: parseTenantId(nonEmpty(env.MOCKBANK_TENANT)),
		sessionIdleMs: intVar(env, 'MOCKBANK_SESSION_IDLE_MS', DEFAULT_CONFIG.sessionIdleMs),
		slowMs: intVar(env, 'MOCKBANK_SLOW_MS', DEFAULT_CONFIG.slowMs),
		faults: parseFaultList(env.MOCKBANK_FAULTS),
	};
}

function nonEmpty(value: string | undefined): string | undefined {
	return value === undefined || value.trim() === '' ? undefined : value.trim();
}

function intVar(env: NodeJS.ProcessEnv, name: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
	const raw = nonEmpty(env[name]);
	if (raw === undefined) return fallback;
	if (!/^\d+$/.test(raw) || Number(raw) > max) {
		throw new ConfigError(`${name} must be an integer between 0 and ${max}, got "${raw}"`);
	}
	return Number(raw);
}
