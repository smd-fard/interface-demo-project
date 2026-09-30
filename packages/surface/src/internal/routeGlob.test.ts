import { describe, expect, it } from 'vitest';
import { matchesRouteGlob } from './routeGlob.js';

describe('matchesRouteGlob', () => {
	it.each([
		['**/member/detail*', '/member/detail', true],
		['**/member/detail*', '/app/member/detail?m=1', true],
		['/member/*', '/member/search', true],
		['/member/*', '/member/a/b', false],
		['/member/**', '/member', true],
		['/login', '/login', true],
		['/login', '/login2', false],
		['**/*.jsp', '/a/b/c.jsp', true],
		['/a.b', '/aXb', false],
	])('%s against %s is %s', (glob, path, expected) => {
		expect(matchesRouteGlob(glob, path)).toBe(expected);
	});
});
