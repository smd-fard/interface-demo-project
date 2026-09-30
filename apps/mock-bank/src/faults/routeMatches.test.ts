import { describe, expect, it } from 'vitest';
import { routeMatches } from './routeMatches.js';

describe('routeMatches', () => {
	it('treats a filter without * as a prefix', () => {
		expect(routeMatches('/member/detail', '/member/detail')).toBe(true);
		expect(routeMatches('/member', '/member/search')).toBe(true);
		expect(routeMatches('/member/detail', '/member/search')).toBe(false);
	});

	it('treats a filter with * as an anchored glob', () => {
		expect(routeMatches('/subaccount/*', '/subaccount/open')).toBe(true);
		expect(routeMatches('/subaccount/*', '/member/detail')).toBe(false);
		expect(routeMatches('*/detail', '/member/detail')).toBe(true);
		expect(routeMatches('/a.b/*', '/aXb/c')).toBe(false);
	});
});
