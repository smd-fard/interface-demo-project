import { describe, expect, it } from 'vitest';
import { NavigationBlockedError } from '../errors/NavigationBlockedError.js';
import { resolveRoute } from './resolveRoute.js';

const origin = 'http://127.0.0.1:4010';

describe('resolveRoute', () => {
	it('resolves routes relative to the origin', () => {
		expect(resolveRoute(origin, '/')).toBe('http://127.0.0.1:4010/');
		expect(resolveRoute(origin, '/member/detail?m=12345')).toBe('http://127.0.0.1:4010/member/detail?m=12345');
		expect(resolveRoute(origin, 'member/search')).toBe('http://127.0.0.1:4010/member/search');
	});

	it.each([
		['//blocked.invalid/x', 'http://blocked.invalid'],
		['https://127.0.0.1:4010/', 'https://127.0.0.1:4010'],
		['http://127.0.0.1:4011/', 'http://127.0.0.1:4011'],
		['javascript:alert(1)', 'javascript:'],
	])('refuses %s, naming only %s', (route, blocked) => {
		const error = (() => {
			try {
				resolveRoute(origin, route);
			} catch (caught) {
				return caught;
			}
			return undefined;
		})();
		expect(error).toBeInstanceOf(NavigationBlockedError);
		expect(error).toMatchObject({ code: 'NAVIGATION_BLOCKED', blockedOrigin: blocked });
	});
});
