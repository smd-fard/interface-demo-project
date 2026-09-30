import type { MockBankConfig } from './config.js';
import { SubAccountLedger } from './data/SubAccountLedger.js';
import { FaultSwitch } from './faults/FaultSwitch.js';
import { SessionStore } from './session/SessionStore.js';
import { TENANTS, type Tenant } from './tenants/tenants.js';

/** Everything a request handler can reach: config, tenant, and the in-memory state. */
export interface AppContext {
	readonly config: MockBankConfig;
	readonly tenant: Tenant;
	readonly sessions: SessionStore;
	readonly faults: FaultSwitch;
	readonly ledger: SubAccountLedger;
	/** `POST /__admin/reset`: sessions cleared, sequence back to 1, faults back to the start-up set. */
	reset(): void;
}

/** Builds the app state for one server: tenant from config, fresh sessions, faults armed from `config.faults`, ledger at 1. */
export function createAppContext(config: MockBankConfig): AppContext {
	const sessions = new SessionStore({ idleMs: config.sessionIdleMs, ...(config.now ? { now: config.now } : {}) });
	const faults = new FaultSwitch(config.faults);
	const ledger = new SubAccountLedger();
	return {
		config,
		tenant: TENANTS[config.tenant],
		sessions,
		faults,
		ledger,
		reset() {
			sessions.clear();
			faults.reset();
			ledger.reset();
		},
	};
}
