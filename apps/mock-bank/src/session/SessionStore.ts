import { randomBytes } from 'node:crypto';
import type { OpenedSubAccount, PendingSubAccount } from '../data/SubAccountLedger.js';
import type { User } from '../data/users.js';

/** The session cookie name (a legacy-looking one). */
export const SESSION_COOKIE = 'CORE1SESSID';

/** A signed-on teller's server-side session. */
export interface Session {
	readonly id: string;
	readonly user: User;
	lastSeen: number;
	/** Set when the session was force-expired (fault `session_timeout`). */
	expired: boolean;
	pending?: PendingSubAccount;
	lastOpened?: OpenedSubAccount;
}

/** What a cookie resolves to. `expired` covers both idle expiry and a forced expiry. */
export type SessionLookup =
	{ readonly kind: 'active'; readonly session: Session } | { readonly kind: 'expired' } | { readonly kind: 'none' };

/** Options of `SessionStore`: the idle timeout and an injectable clock. */
export interface SessionStoreOptions {
	/** Idle timeout in ms: a session unused for longer than this is expired on its next use. */
	readonly idleMs: number;
	/** Injectable clock (ms since epoch). */
	readonly now?: () => number;
	/** Injectable id generator. */
	readonly newId?: () => string;
}

/** In-memory cookie sessions with an idle timeout. */
export class SessionStore {
	private readonly sessions = new Map<string, Session>();
	private readonly now: () => number;
	private readonly newId: () => string;

	constructor(private readonly options: SessionStoreOptions) {
		this.now = options.now ?? Date.now;
		this.newId = options.newId ?? (() => randomBytes(16).toString('hex').toUpperCase());
	}

	create(user: User): Session {
		const session: Session = { id: this.newId(), user, lastSeen: this.now(), expired: false };
		this.sessions.set(session.id, session);
		return session;
	}

	/**
	 * Resolves a session id and, when active, refreshes its idle timer. An expired session is reported
	 * once as `expired` and then forgotten; an unknown id is `none`.
	 */
	lookup(id: string | undefined): SessionLookup {
		if (id === undefined) return { kind: 'none' };
		const session = this.sessions.get(id);
		if (!session) return { kind: 'none' };
		const now = this.now();
		if (session.expired || now - session.lastSeen > this.options.idleMs) {
			this.sessions.delete(id);
			return { kind: 'expired' };
		}
		session.lastSeen = now;
		return { kind: 'active', session };
	}

	/** Force-expires a session: its next lookup reports `expired`. */
	expire(id: string): void {
		const session = this.sessions.get(id);
		if (session) session.expired = true;
	}

	destroy(id: string): void {
		this.sessions.delete(id);
	}

	clear(): void {
		this.sessions.clear();
	}

	get size(): number {
		return this.sessions.size;
	}
}
