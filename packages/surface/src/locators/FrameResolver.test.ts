import { describe, expect, it } from 'vitest';
import { FrameNotFoundError } from '../errors/FrameNotFoundError.js';
import { fakeFrameTree } from './fakeFrames.test-helper.js';
import { framePathOf, frameScopeOf, resolveFrameScope } from './FrameResolver.js';

const top = fakeFrameTree({
	url: 'http://bank.test/',
	title: 'CoreOne 7.4',
	children: [
		{ name: 'banner', url: 'http://bank.test/banner' },
		{ name: 'nav', url: 'http://bank.test/nav' },
		{
			name: 'content',
			url: 'http://bank.test/member/detail?m=1',
			title: 'CoreOne - Member Inquiry',
			children: [{ url: 'http://bank.test/member/balances.jsp', titleAttribute: 'Balances' }],
		},
		{ name: 'dup', url: 'http://bank.test/a' },
		{ name: 'dup', url: 'http://bank.test/b' },
	],
});

describe('resolveFrameScope', () => {
	it('returns the top frame for an empty scope', async () => {
		expect(await resolveFrameScope(top, [])).toBe(top);
	});

	it('follows by_name, by_url_path (glob over the path) and by_title hops', async () => {
		const content = await resolveFrameScope(top, [{ kind: 'by_name', name: 'content' }]);
		expect(content.name()).toBe('content');
		const inner = await resolveFrameScope(top, [
			{ kind: 'by_name', name: 'content' },
			{ kind: 'by_url_path', glob: '**/*.jsp' },
		]);
		expect(inner.url()).toContain('balances.jsp');
		expect(await resolveFrameScope(top, [{ kind: 'by_title', title: 'CoreOne - Member Inquiry' }])).toBe(content);
		expect(
			await resolveFrameScope(top, [
				{ kind: 'by_name', name: 'content' },
				{ kind: 'by_title', title: 'Balances' },
			]),
		).toBe(inner);
	});

	it('throws FrameNotFoundError with the hop index and match count for a missing or ambiguous hop', async () => {
		await expect(resolveFrameScope(top, [{ kind: 'by_name', name: 'main' }])).rejects.toMatchObject({
			code: 'FRAME_NOT_FOUND',
			hopIndex: 0,
			matches: 0,
		});
		const ambiguous = resolveFrameScope(top, [{ kind: 'by_name', name: 'dup' }]);
		await expect(ambiguous).rejects.toBeInstanceOf(FrameNotFoundError);
		await expect(ambiguous).rejects.toMatchObject({ matches: 2 });
		await expect(
			resolveFrameScope(top, [
				{ kind: 'by_name', name: 'content' },
				{ kind: 'by_name', name: 'x' },
			]),
		).rejects.toMatchObject({ hopIndex: 1 });
	});
});

describe('framePathOf / frameScopeOf', () => {
	it('names each hop, using #<index> for an unnamed frame', async () => {
		const inner = await resolveFrameScope(top, [
			{ kind: 'by_name', name: 'content' },
			{ kind: 'by_url_path', glob: '**/*.jsp' },
		]);
		expect(framePathOf(top)).toEqual([]);
		expect(framePathOf(inner)).toEqual(['content', '#0']);
	});

	it('builds a FrameScope: by_name for named frames, by_url_path for unnamed ones', async () => {
		const inner = await resolveFrameScope(top, [
			{ kind: 'by_name', name: 'content' },
			{ kind: 'by_url_path', glob: '**/*.jsp' },
		]);
		expect(frameScopeOf(inner)).toEqual([
			{ kind: 'by_name', name: 'content' },
			{ kind: 'by_url_path', glob: '/member/balances.jsp' },
		]);
		expect(frameScopeOf(top)).toEqual([]);
	});
});
