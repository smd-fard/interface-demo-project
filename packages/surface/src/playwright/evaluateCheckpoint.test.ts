import type { TargetRef } from '@idp/artifact-schema';
import type { Frame, Locator, Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { FrameNotFoundError } from '../errors/FrameNotFoundError.js';
import { TargetNotResolvedError } from '../errors/TargetNotResolvedError.js';
import type { LadderMatch } from '../locators/LadderResolver.js';
import { evaluateCheckpoint, type CheckpointDeps } from './evaluateCheckpoint.js';

/** What a fake frame's `evaluate` (its body text) does: return text, or throw. */
type Read = string | Error;

interface FakeFrameSpec {
	readonly name: string;
	readonly read: Read;
}

/** A top frame with named child frames: just enough of Playwright's `Page`/`Frame` for the evaluator. */
function fakePage(children: FakeFrameSpec[]): Page {
	const top: Record<string, unknown> = {};
	const make = (spec: FakeFrameSpec, parent: unknown): Frame =>
		({
			name: () => spec.name,
			url: () => `http://bank.test/${spec.name}`,
			title: async () => spec.name,
			isDetached: () => false,
			parentFrame: () => parent,
			childFrames: () => [],
			frameElement: async () => ({ getAttribute: async () => null }),
			evaluate: async () => {
				if (spec.read instanceof Error) throw spec.read;
				return spec.read;
			},
		}) as unknown as Frame;
	const frames = children.map((child) => make(child, top));
	Object.assign(top, make({ name: '', read: '' }, null), { childFrames: () => frames });
	const main = top as unknown as Frame;
	return { mainFrame: () => main, frames: () => [main, ...frames] } as unknown as Page;
}

const navigating = new Error('frame.evaluate: Execution context was destroyed, most likely because of a navigation');
const content = [{ kind: 'by_name' as const, name: 'content' }];
const target: TargetRef = {
	description: 'Search button',
	frame: content,
	ladder: [{ kind: 'role', role: 'button', name: 'Search', exact: true, rationale: 'test' }],
};

function deps(page: Page, resolve: CheckpointDeps['resolve'] = () => Promise.reject(new Error('unused'))) {
	return { page, resolve };
}

describe('evaluateCheckpoint: an unreadable page never satisfies a negative checkpoint', () => {
	it('text_absent: a frame that went away mid-read is unreadable, not "absent"', async () => {
		const page = fakePage([{ name: 'content', read: navigating }]);
		const result = await evaluateCheckpoint(deps(page), { kind: 'text_absent', text: 'Error' }, {});
		expect(result).toMatchObject({ kind: 'not_held' });
		expect(result.kind === 'not_held' && result.observed).toMatch(
			/^frame unreadable: frame "content" went away while read \(frame\.evaluate: Execution context was destroyed/,
		);
	});

	it('text_absent: a scoped frame that does not resolve is unreadable', async () => {
		const page = fakePage([{ name: 'nav', read: 'Menu' }]);
		const result = await evaluateCheckpoint(deps(page), { kind: 'text_absent', text: 'Error', frame: content }, {});
		expect(result).toEqual({
			kind: 'not_held',
			observed: 'frame unreadable: frame hop 0 (by_name "content") matched 0 frames',
		});
	});

	it('text_absent holds when every frame was read and none has the text', async () => {
		const page = fakePage([{ name: 'content', read: 'Member Search' }]);
		expect(await evaluateCheckpoint(deps(page), { kind: 'text_absent', text: 'Error' }, {})).toEqual({ kind: 'held' });
	});

	it('text_absent is refuted by a readable frame even when another is unreadable', async () => {
		const page = fakePage([
			{ name: 'nav', read: navigating },
			{ name: 'content', read: 'Runtime Error' },
		]);
		const result = await evaluateCheckpoint(deps(page), { kind: 'text_absent', text: 'Runtime Error' }, {});
		expect(result).toEqual({ kind: 'not_held', observed: 'text "Runtime Error" present in any frame' });
	});

	it('text_present holds from a readable frame even when another is unreadable', async () => {
		const page = fakePage([
			{ name: 'nav', read: navigating },
			{ name: 'content', read: 'Member Inquiry' },
		]);
		expect(await evaluateCheckpoint(deps(page), { kind: 'text_present', text: 'Member Inquiry' }, {})).toEqual({
			kind: 'held',
		});
	});

	it('a real evaluation error (not a frame going away) is thrown, not read as empty text', async () => {
		const page = fakePage([{ name: 'content', read: new TypeError('boom') }]);
		await expect(evaluateCheckpoint(deps(page), { kind: 'text_absent', text: 'x' }, {})).rejects.toThrow('boom');
	});

	it('element_absent: a missing frame, or rung counting that failed, is unreadable; no match at all holds', async () => {
		const page = fakePage([]);
		const missingFrame = await evaluateCheckpoint(
			deps(page, () => Promise.reject(new FrameNotFoundError(0, 'by_name "content"', 0))),
			{ kind: 'element_absent', target },
			{},
		);
		expect(missingFrame).toEqual({
			kind: 'not_held',
			observed: 'frame unreadable: frame hop 0 (by_name "content") matched 0 frames',
		});
		const countFailed = await evaluateCheckpoint(
			deps(page, () =>
				Promise.reject(
					new TargetNotResolvedError('Search button', [
						{ index: 0, kind: 'role', matches: 0, error: 'Frame was detached' },
					]),
				),
			),
			{ kind: 'element_absent', target },
			{},
		);
		expect(countFailed).toEqual({ kind: 'not_held', observed: 'frame unreadable: rung 0 role: Frame was detached' });
		const gone = await evaluateCheckpoint(
			deps(page, () =>
				Promise.reject(new TargetNotResolvedError('Search button', [{ index: 0, kind: 'role', matches: 0 }])),
			),
			{ kind: 'element_absent', target },
			{},
		);
		expect(gone).toEqual({ kind: 'held' });
	});

	it('element_absent: a visibility read on a navigating frame is unreadable', async () => {
		const page = fakePage([]);
		const locator = {
			isVisible: () => Promise.reject(new Error('locator.isVisible: Frame has been detached.')),
		} as unknown as Locator;
		const match = { rungIndex: 0, rungKind: 'role', frame: page.mainFrame(), locator } as LadderMatch<Frame, Locator>;
		const result = await evaluateCheckpoint(
			deps(page, () => Promise.resolve(match)),
			{ kind: 'element_absent', target },
			{},
		);
		expect(result).toEqual({
			kind: 'not_held',
			observed: 'frame unreadable: locator.isVisible: Frame has been detached.',
		});
	});

	it('all_of reports the unreadable leaf', async () => {
		const page = fakePage([{ name: 'content', read: navigating }]);
		const result = await evaluateCheckpoint(
			deps(page),
			{ kind: 'all_of', checks: [{ kind: 'text_absent', text: 'Error', frame: content }] },
			{},
		);
		expect(result.kind === 'not_held' && result.observed).toMatch(/^all_of\[0\] text_absent: frame unreadable: /);
	});
});
