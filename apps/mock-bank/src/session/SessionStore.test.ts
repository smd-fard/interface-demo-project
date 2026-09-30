import { describe, expect, it } from 'vitest';
import { USERS } from '../data/users.js';
import { SessionStore } from './SessionStore.js';

const [teller] = USERS;
if (!teller) throw new Error('no seeded users');

function storeWithClock(idleMs = 1_000) {
	let now = 0;
	let seq = 0;
	const store = new SessionStore({ idleMs, now: () => now, newId: () => `S${++seq}` });
	return { store, advance: (ms: number) => (now += ms) };
}

describe('SessionStore', () => {
	it('creates and resolves an active session', () => {
		const { store } = storeWithClock();
		const session = store.create(teller);
		const found = store.lookup(session.id);
		expect(found.kind).toBe('active');
	});

	it('reports none for a missing or unknown id', () => {
		const { store } = storeWithClock();
		expect(store.lookup(undefined).kind).toBe('none');
		expect(store.lookup('nope').kind).toBe('none');
	});

	it('refreshes the idle timer on each lookup', () => {
		const { store, advance } = storeWithClock(1_000);
		const { id } = store.create(teller);
		advance(900);
		expect(store.lookup(id).kind).toBe('active');
		advance(900);
		expect(store.lookup(id).kind).toBe('active');
	});

	it('expires after the idle timeout, once, then forgets the session', () => {
		const { store, advance } = storeWithClock(1_000);
		const { id } = store.create(teller);
		advance(1_001);
		expect(store.lookup(id).kind).toBe('expired');
		expect(store.lookup(id).kind).toBe('none');
		expect(store.size).toBe(0);
	});

	it('force-expires a session on request', () => {
		const { store } = storeWithClock();
		const { id } = store.create(teller);
		store.expire(id);
		expect(store.lookup(id).kind).toBe('expired');
	});

	it('destroys and clears sessions', () => {
		const { store } = storeWithClock();
		const a = store.create(teller);
		store.create(teller);
		store.destroy(a.id);
		expect(store.lookup(a.id).kind).toBe('none');
		store.clear();
		expect(store.size).toBe(0);
	});
});
