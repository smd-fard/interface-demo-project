import { createRedactor } from '@idp/policy';
import type { A11yNode, FrameInfo, Observation } from '@idp/surface';
import { describe, expect, it } from 'vitest';
import { computeScreenDiff } from './computeScreenDiff.js';

const redactor = createRedactor({ sensitiveValues: [{ value: '12345', paramName: 'memberId' }, 'Jane Sample'] });

function frame(path: string[], title: string, url: string, text: string): FrameInfo {
	return { path, name: path.at(-1) ?? '', url, title, status: 200, text, textTruncated: false };
}

function node(role: string, name: string, framePath: string[], children: A11yNode[] = []): A11yNode {
	return { role, name, framePath, children, ref: 'e1' };
}

function screen(content: { title: string; url: string; text: string; nodes: A11yNode[] } | null): Observation {
	const frames = [frame([], 'CoreOne 7.4', 'http://bank.test/', '')];
	const children: A11yNode[] = [];
	if (content !== null) {
		frames.push(frame(['content'], content.title, content.url, content.text));
		children.push({
			role: 'iframe',
			name: '',
			framePath: [],
			children: [{ role: 'document', name: '', framePath: ['content'], children: content.nodes }],
		});
	}
	return {
		url: 'http://bank.test/',
		title: 'CoreOne 7.4',
		frames,
		tree: { role: 'document', name: '', framePath: [], children },
		pendingDialog: null,
		lastNavigation: null,
		digest: JSON.stringify(content),
	};
}

const signOn = screen({
	title: 'CoreOne - Sign On',
	url: 'http://bank.test/login',
	text: 'Sign On User ID Password',
	nodes: [node('button', 'Sign On', ['content'])],
});
const search = screen({
	title: 'CoreOne - Member Search',
	url: 'http://bank.test/member/search',
	text: 'Member Search Member #',
	nodes: [node('heading', 'Member Search', ['content']), node('button', 'Search', ['content'])],
});

describe('computeScreenDiff', () => {
	it('reports the title change with its segment visible in the frame, new headings, elements and routes', () => {
		const diff = computeScreenDiff(signOn, search, { redactor, loadedFrame: ['content'] });
		expect(diff.loadedFrame).toEqual(['content']);
		expect(diff.titleChanges).toEqual([
			{
				frame: ['content'],
				before: 'CoreOne - Sign On',
				after: 'CoreOne - Member Search',
				visibleSegments: ['Member Search'],
			},
		]);
		expect(diff.headingsAdded).toEqual([{ frame: ['content'], text: 'Member Search' }]);
		expect(diff.elementsAdded).toEqual([
			{ frame: ['content'], role: 'heading', name: 'Member Search' },
			{ frame: ['content'], role: 'button', name: 'Search' },
		]);
		expect(diff.routeChanges).toEqual([{ frame: ['content'], before: '/login', after: '/member/search' }]);
		expect(diff.presentTexts).toEqual([{ frame: ['content'], text: 'Member Search' }]);
	});

	it('treats a frame that did not exist before as changed (the first navigation)', () => {
		const diff = computeScreenDiff(screen(null), signOn, { redactor, loadedFrame: null });
		expect(diff.titleChanges).toContainEqual({
			frame: ['content'],
			before: null,
			after: 'CoreOne - Sign On',
			visibleSegments: ['Sign On'],
		});
		expect(diff.routeChanges).toContainEqual({ frame: ['content'], before: null, after: '/login' });
	});

	it('reports nothing for an unchanged screen', () => {
		const diff = computeScreenDiff(search, search, { redactor, loadedFrame: null });
		expect(diff.titleChanges).toEqual([]);
		expect(diff.headingsAdded).toEqual([]);
		expect(diff.elementsAdded).toEqual([]);
		expect(diff.routeChanges).toEqual([]);
		expect(diff.dialogOpened).toBe(false);
		expect(diff.dialogClosed).toBe(false);
	});

	it('placeholderizes and masks every stored string', () => {
		const detail = screen({
			title: 'CoreOne - Member 12345',
			url: 'http://bank.test/member/detail?txt1=12345',
			text: 'Member 12345 Jane Sample',
			nodes: [node('link', 'Jane Sample', ['content']), node('link', 'Member 12345', ['content'])],
		});
		const json = JSON.stringify(computeScreenDiff(search, detail, { redactor, loadedFrame: ['content'] }));
		expect(json).not.toContain('12345');
		expect(json).not.toContain('Jane Sample');
		expect(json).toContain('{{memberId}}');
	});

	it('notices a dialog opening and closing', () => {
		const withDialog = { ...search, pendingDialog: { type: 'alert' as const, message: 'Scheduled maintenance' } };
		expect(computeScreenDiff(search, withDialog, { redactor, loadedFrame: null }).dialogOpened).toBe(true);
		expect(computeScreenDiff(withDialog, search, { redactor, loadedFrame: null }).dialogClosed).toBe(true);
	});
});
