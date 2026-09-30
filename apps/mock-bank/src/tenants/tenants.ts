import { ConfigError } from '../errors/ConfigError.js';

/** A tenant of the same vendor app: `a` (default) or `b` (the drift variant). */
export type TenantId = 'a' | 'b';

/** A nav-menu entry. The same entries exist for every tenant; only their order differs. */
export interface MenuItem {
	readonly key: 'search' | 'about' | 'signoff';
	readonly text: string;
	readonly href: string;
}

const MENU: Record<MenuItem['key'], MenuItem> = {
	search: { key: 'search', text: 'Member Search', href: '/member/search' },
	about: { key: 'about', text: 'About CoreOne', href: '/about' },
	signoff: { key: 'signoff', text: 'Sign Off', href: '/logout' },
};

/**
 * Per-tenant configuration of the *same* vendor app. Only what differs lives here; screens read it and
 * everything else (titles, other labels, messages) is shared.
 */
export interface Tenant {
	readonly id: TenantId;
	/** Version string shown in the frameset title and the banner, e.g. `CoreOne 7.4`. */
	readonly version: string;
	readonly build: string;
	readonly institution: string;
	readonly bannerColor: string;
	readonly labels: {
		/** Label of the member-number row on Member Search. */
		readonly memberNumber: string;
		/** Caption of the search button. */
		readonly searchButton: string;
	};
	readonly menu: readonly MenuItem[];
}

/** The two tenant configurations, by id. */
export const TENANTS: Record<TenantId, Tenant> = {
	a: {
		id: 'a',
		version: 'CoreOne 7.4',
		build: '7.4.0.311',
		institution: 'First Synthetic Credit Union',
		bannerColor: '#003366',
		labels: { memberNumber: 'Member #', searchButton: 'Search' },
		menu: [MENU.search, MENU.about, MENU.signoff],
	},
	b: {
		id: 'b',
		version: 'CoreOne 7.2',
		build: '7.2.3.118',
		institution: 'Placeholder Valley FCU',
		bannerColor: '#660000',
		labels: { memberNumber: 'Account holder ID', searchButton: 'Find' },
		menu: [MENU.about, MENU.signoff, MENU.search],
	},
};

/** Parses `MOCKBANK_TENANT` (`a` | `b`, case-insensitive; default `a`). */
export function parseTenantId(raw: string | undefined): TenantId {
	const value = (raw ?? 'a').trim().toLowerCase();
	if (value === 'a' || value === 'b') return value;
	throw new ConfigError(`MOCKBANK_TENANT must be "a" or "b", got "${raw}"`);
}
