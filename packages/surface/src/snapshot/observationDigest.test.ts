import { describe, expect, it } from 'vitest';
import type { A11yNode, FrameInfo } from '../port/Observation.js';
import { observationDigest } from './observationDigest.js';

const tree = (value: string, ref = 'e1'): A11yNode => ({
	role: 'document',
	name: '',
	framePath: [],
	children: [{ ref, role: 'textbox', name: '', value, framePath: [], children: [] }],
});
const topFrame: FrameInfo = {
	path: [],
	name: '',
	url: 'http://x/',
	title: 'T',
	status: 200,
	text: 'Hello',
	textTruncated: false,
};
const frames: FrameInfo[] = [topFrame];

describe('observationDigest', () => {
	const base = { url: 'http://x/', title: 'T', frames, tree: tree('a'), pendingDialog: null };

	it('is a 64-char hex hash, stable for the same screen', () => {
		expect(observationDigest(base)).toMatch(/^[0-9a-f]{64}$/);
		expect(observationDigest(base)).toBe(observationDigest({ ...base }));
	});

	it('ignores refs (they are renumbered on every observation)', () => {
		expect(observationDigest({ ...base, tree: tree('a', 'e7') })).toBe(observationDigest(base));
	});

	it('changes when a value, url, frame title or dialog changes', () => {
		const digest = observationDigest(base);
		expect(observationDigest({ ...base, tree: tree('b') })).not.toBe(digest);
		expect(observationDigest({ ...base, url: 'http://x/y' })).not.toBe(digest);
		expect(observationDigest({ ...base, frames: [{ ...topFrame, title: 'U' }] })).not.toBe(digest);
		expect(observationDigest({ ...base, pendingDialog: { type: 'alert', message: 'm' } })).not.toBe(digest);
	});
});
