import { describe, expect, it } from 'vitest';
import { blockedOriginOf, isRequestAllowed } from './networkGuard.js';

const allowed = ['http://127.0.0.1:4010'];

describe('isRequestAllowed', () => {
	it.each([
		['http://127.0.0.1:4010/member/search?m=1', true],
		['http://127.0.0.1:4010', true],
		['http://127.0.0.1:4011/', false],
		['https://127.0.0.1:4010/', false],
		['http://evil.example/', false],
		['about:blank', true],
		['data:text/html,hi', true],
		['file:///etc/passwd', false],
		['javascript:alert(1)', false],
		['not a url', false],
	])('%s → %s', (url, expected) => {
		expect(isRequestAllowed(url, allowed)).toBe(expected);
	});

	it('normalizes allowlist entries (trailing slash, default port)', () => {
		expect(isRequestAllowed('http://bank.test/x', ['http://bank.test:80/'])).toBe(true);
	});
});

describe('blockedOriginOf', () => {
	it('reports only the origin or scheme, never the path or query', () => {
		expect(blockedOriginOf('http://evil.example/steal?ssn=900-00-0000')).toBe('http://evil.example');
		expect(blockedOriginOf('file:///etc/passwd')).toBe('file:');
		expect(blockedOriginOf('::bad')).toBe('(invalid url)');
	});
});
