import { describe, expect, it } from 'vitest';
import { findRoute, ROUTES } from './router.js';

describe('router', () => {
	it('finds routes by method and exact path', () => {
		const match = findRoute('POST', '/login');
		expect(match.kind).toBe('found');
		expect(match.kind === 'found' && match.route.kind).toBe('public');
	});

	it('distinguishes a wrong method from an unknown path', () => {
		expect(findRoute('DELETE', '/login').kind).toBe('method_not_allowed');
		expect(findRoute('GET', '/nope').kind).toBe('not_found');
	});

	it('keeps admin endpoints under /__ and has no duplicate method+path', () => {
		for (const route of ROUTES) {
			if (route.kind === 'admin') expect(route.path.startsWith('/__')).toBe(true);
			else expect(route.path.startsWith('/__')).toBe(false);
		}
		const keys = ROUTES.map((route) => `${route.method} ${route.path}`);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
