import { describe, expect, it } from 'vitest';
import { compileRouteGlob } from './matchRouteGlob.js';

describe('compileRouteGlob', () => {
	it('"*" matches within one segment only', () => {
		const glob = compileRouteGlob('/member/*');
		expect(glob('/member/123')).toBe(true);
		expect(glob('/member/123/detail')).toBe(false);
		expect(glob('/members/1')).toBe(false);
	});

	it('"**" matches at any depth, including none', () => {
		const glob = compileRouteGlob('/member/**');
		expect(glob('/member')).toBe(true);
		expect(glob('/member/')).toBe(true);
		expect(glob('/member/1/detail')).toBe(true);
		expect(glob('/memberX')).toBe(false);
		expect(compileRouteGlob('/**')('/')).toBe(true);
		expect(compileRouteGlob('/a/**/z')('/a/z')).toBe(true);
		expect(compileRouteGlob('/a/**/z')('/a/b/c/z')).toBe(true);
	});

	it('matches literally otherwise (regex metacharacters are escaped)', () => {
		expect(compileRouteGlob('/subaccount/confirm')('/subaccount/confirm')).toBe(true);
		expect(compileRouteGlob('/a.b')('/axb')).toBe(false);
		expect(compileRouteGlob('/a+b')('/a+b')).toBe(true);
	});
});
