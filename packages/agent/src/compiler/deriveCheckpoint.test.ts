import type { TargetRef } from '@idp/artifact-schema';
import { describe, expect, it } from 'vitest';
import { UncheckpointableStepError } from '../errors/UncheckpointableStepError.js';
import type { ScreenDiff } from '../trace/ScreenDiff.js';
import { deriveCheckpoint } from './deriveCheckpoint.js';
import { createTextGuard } from './TextGuard.js';

const content = [{ kind: 'by_name' as const, name: 'content' }];
const guard = createTextGuard(['12345']);
const empty: ScreenDiff = {
	loadedFrame: null,
	titleChanges: [],
	headingsAdded: [],
	elementsAdded: [],
	routeChanges: [],
	presentTexts: [],
	dialogOpened: false,
	dialogClosed: false,
};
const productSelect: TargetRef = {
	description: 'combobox "Product"',
	frame: content,
	ladder: [
		{ kind: 'structural', anchor: { kind: 'form_row', labelText: 'Product', control: 'select' }, rationale: 'r' },
	],
};

describe('deriveCheckpoint', () => {
	it('1. prefers the visible part of a changed title in the frame that loaded', () => {
		const diff: ScreenDiff = {
			...empty,
			loadedFrame: ['content'],
			titleChanges: [
				{ frame: [], before: '', after: 'CoreOne 7.4', visibleSegments: [] },
				{
					frame: ['content'],
					before: 'CoreOne - Sign On',
					after: 'CoreOne - Member Search',
					visibleSegments: ['Member Search'],
				},
			],
			elementsAdded: [{ frame: ['content'], role: 'button', name: 'Search' }],
			routeChanges: [{ frame: ['content'], before: '/login', after: '/member/search' }],
		};
		expect(deriveCheckpoint({ index: 3, kind: 'click', diff }, { guard })).toEqual({
			kind: 'text_present',
			text: 'Member Search',
			frame: content,
		});
	});

	it('1. then a new heading, then the changed title itself', () => {
		const heading: ScreenDiff = { ...empty, headingsAdded: [{ frame: ['content'], text: 'Member Inquiry' }] };
		expect(deriveCheckpoint({ index: 0, kind: 'click', diff: heading }, { guard })).toEqual({
			kind: 'text_present',
			text: 'Member Inquiry',
			frame: content,
		});
		const title: ScreenDiff = {
			...empty,
			titleChanges: [{ frame: [], before: 'A', after: 'CoreOne 7.4', visibleSegments: [] }],
		};
		expect(deriveCheckpoint({ index: 0, kind: 'navigate', diff: title }, { guard })).toEqual({
			kind: 'title_matches',
			title: 'CoreOne 7.4',
			match: 'contains',
		});
	});

	it('2. a newly visible role+name element', () => {
		const diff: ScreenDiff = {
			...empty,
			elementsAdded: [
				{ frame: ['content'], role: 'textbox', name: 'Nickname' },
				{ frame: ['content'], role: 'button', name: 'Continue' },
			],
			routeChanges: [{ frame: ['content'], before: '/a', after: '/b' }],
		};
		expect(deriveCheckpoint({ index: 0, kind: 'click', diff }, { guard })).toEqual({
			kind: 'element_visible',
			target: {
				description: 'button "Continue"',
				frame: content,
				ladder: [{ kind: 'role', role: 'button', name: 'Continue', exact: true, rationale: expect.any(String) }],
			},
		});
	});

	it('3. a route change', () => {
		const diff: ScreenDiff = {
			...empty,
			routeChanges: [{ frame: ['content'], before: '/a', after: '/member/detail' }],
		};
		expect(deriveCheckpoint({ index: 0, kind: 'press', diff }, { guard })).toEqual({
			kind: 'url_matches',
			route: '/member/detail',
		});
	});

	it('never uses a text holding a value, a mask or a placeholder', () => {
		const diff: ScreenDiff = {
			...empty,
			titleChanges: [{ frame: ['content'], before: 'x', after: 'Member 12345', visibleSegments: ['Member 12345'] }],
			headingsAdded: [{ frame: ['content'], text: 'Member {{memberId}}' }],
			elementsAdded: [{ frame: ['content'], role: 'link', name: '[REDACTED]' }],
			routeChanges: [{ frame: ['content'], before: '/a', after: '/member/detail' }],
		};
		expect(deriveCheckpoint({ index: 0, kind: 'click', diff }, { guard })).toEqual({
			kind: 'url_matches',
			route: '/member/detail',
		});
	});

	it('fill, extract and wait need no checkpoint', () => {
		for (const kind of ['fill', 'extract', 'wait'] as const) {
			expect(deriveCheckpoint({ index: 0, kind, diff: empty }, { guard })).toBeUndefined();
		}
	});

	it('a select that changes nothing is checked by its own target staying visible', () => {
		expect(deriveCheckpoint({ index: 0, kind: 'select', diff: empty, target: productSelect }, { guard })).toEqual({
			kind: 'element_visible',
			target: productSelect,
		});
	});

	it('a dismissed dialog with nothing else changed falls back to a title text that is present', () => {
		const diff: ScreenDiff = {
			...empty,
			dialogClosed: true,
			presentTexts: [{ frame: ['content'], text: 'Member Inquiry' }],
		};
		expect(deriveCheckpoint({ index: 0, kind: 'dismiss_dialog', diff }, { guard })).toEqual({
			kind: 'text_present',
			text: 'Member Inquiry',
			frame: content,
		});
	});

	it('throws UncheckpointableStepError for a screen-changing step with no verifiable change', () => {
		expect(() => deriveCheckpoint({ index: 4, kind: 'click', diff: empty }, { guard })).toThrow(
			UncheckpointableStepError,
		);
		expect(() => deriveCheckpoint({ index: 4, kind: 'navigate', diff: null }, { guard })).toThrow(
			UncheckpointableStepError,
		);
	});

	it('scopes to any frame when a frame on the path has no name', () => {
		const diff: ScreenDiff = { ...empty, headingsAdded: [{ frame: ['#1'], text: 'Results' }] };
		expect(deriveCheckpoint({ index: 0, kind: 'click', diff }, { guard })).toEqual({
			kind: 'text_present',
			text: 'Results',
		});
	});
});
