import type { LocatorRung, TargetRef } from '@idp/artifact-schema';
import { describe, expect, it } from 'vitest';
import { BindingMissingError } from '../errors/BindingMissingError.js';
import { FrameNotFoundError } from '../errors/FrameNotFoundError.js';
import { TargetNotResolvedError } from '../errors/TargetNotResolvedError.js';
import { fakeFrameTree, type FakeFrame } from './fakeFrames.test-helper.js';
import { LadderResolver } from './LadderResolver.js';

const rationale = 'test';
const role: LocatorRung = { kind: 'role', role: 'button', name: 'Search', exact: true, rationale };
const text: LocatorRung = { kind: 'text', text: 'Search', match: 'exact', rationale };
const formRow: LocatorRung = {
	kind: 'structural',
	anchor: { kind: 'form_row', labelText: 'Member #', control: 'button' },
	rationale,
};
const target = (ladder: LocatorRung[], frame: TargetRef['frame'] = [{ kind: 'by_name', name: 'content' }]) => ({
	description: 'Search button',
	frame,
	ladder,
});

/** Counts per rung kind for each attempt; a function lets an attempt throw (a detached frame). */
function setup(counts: Record<string, number | (() => number)>[]) {
	const tree = fakeFrameTree({ url: 'http://bank.test/', children: [{ name: 'content', url: 'http://bank.test/x' }] });
	let attempt = -1;
	let clock = 0;
	const sleeps: number[] = [];
	const calls: { frame: string; kind: string; attempt: number }[] = [];
	const resolver = new LadderResolver<FakeFrame, { count(): Promise<number>; kind: string }>({
		root: () => {
			attempt += 1;
			return tree;
		},
		toLocator: (frame, rung) => {
			const at = attempt;
			calls.push({ frame: frame.name(), kind: rung.kind, attempt: at });
			return {
				kind: rung.kind,
				count: async () => {
					const value = (counts[Math.min(at, counts.length - 1)] ?? {})[rung.kind] ?? 0;
					return typeof value === 'function' ? value() : value;
				},
			};
		},
		sleep: async (ms) => {
			sleeps.push(ms);
			clock += ms;
		},
		now: () => clock,
	});
	return { resolver, calls, sleeps };
}

describe('LadderResolver', () => {
	it('returns the first rung that matches exactly one element, in the target frame', async () => {
		const { resolver, calls } = setup([{ role: 1, text: 1 }]);
		const match = await resolver.resolve(target([role, text]), {});
		expect(match).toMatchObject({ rungIndex: 0, rungKind: 'role' });
		expect(match.locator.kind).toBe('role');
		expect(match.frame.name()).toBe('content');
		expect(calls).toEqual([{ frame: 'content', kind: 'role', attempt: 0 }]);
	});

	it('falls back past a rung with 0 or several matches (drift)', async () => {
		const { resolver } = setup([{ role: 0, text: 2, structural: 1 }]);
		expect(await resolver.resolve(target([role, text, formRow]), {})).toMatchObject({
			rungIndex: 2,
			rungKind: 'structural',
		});
	});

	it('re-resolves once, then throws TargetNotResolvedError with per-rung counts', async () => {
		const { resolver, calls } = setup([{ role: 0, text: 3 }]);
		const error = await resolver.resolve(target([role, text]), {}).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(TargetNotResolvedError);
		expect(error).toMatchObject({
			code: 'TARGET_UNRESOLVED',
			target: 'Search button',
			rungs: [
				{ index: 0, kind: 'role', matches: 0 },
				{ index: 1, kind: 'text', matches: 3 },
			],
		});
		expect((error as Error).message).toContain('rung 1 text: 3 matches');
		expect(calls.map((call) => call.attempt)).toEqual([0, 0, 1, 1]);
	});

	it('recovers from a stale frame on the second attempt', async () => {
		const detached = () => {
			throw new Error('Frame was detached');
		};
		const { resolver } = setup([{ role: detached }, { role: 1 }]);
		expect(await resolver.resolve(target([role]), {})).toMatchObject({ rungIndex: 0 });
	});

	it('records a counting error on the rung when both attempts fail', async () => {
		const detached = () => {
			throw new Error('Frame was detached');
		};
		const { resolver } = setup([{ role: detached }]);
		await expect(resolver.resolve(target([role]), {})).rejects.toMatchObject({
			rungs: [{ index: 0, kind: 'role', matches: 0, error: 'Frame was detached' }],
		});
	});

	it('throws FrameNotFoundError when the frame scope does not resolve after the retry', async () => {
		const { resolver } = setup([{ role: 1 }]);
		await expect(resolver.resolve(target([role], [{ kind: 'by_name', name: 'main' }]), {})).rejects.toBeInstanceOf(
			FrameNotFoundError,
		);
	});

	it('polls until a late element renders within the bound (the top rung wins once it is there)', async () => {
		// Nothing for four passes, then the element is there for every rung.
		const late: Record<string, number>[] = [{}, {}, {}, {}, { role: 1, text: 1 }];
		const { resolver, sleeps } = setup(late);
		expect(await resolver.resolve(target([role, text]), {}, 5_000)).toMatchObject({ rungIndex: 0, rungKind: 'role' });
		expect(sleeps).toEqual([100, 150, 225, 250]);
	});

	it('gives up at the bound with the last pass counts, the final pause cut to what is left', async () => {
		const { resolver, sleeps, calls } = setup([{ role: 0 }]);
		await expect(resolver.resolve(target([role]), {}, 1_000)).rejects.toBeInstanceOf(TargetNotResolvedError);
		expect(sleeps).toEqual([100, 150, 225, 250, 250, 25]);
		expect(sleeps.reduce((sum, ms) => sum + ms, 0)).toBe(1_000);
		expect(new Set(calls.map((call) => call.attempt)).size).toBe(7);
	});

	it('timeoutMs 0 is a single pass', async () => {
		const { resolver, calls, sleeps } = setup([{ role: 0 }, { role: 1 }]);
		await expect(resolver.resolve(target([role]), {}, 0)).rejects.toBeInstanceOf(TargetNotResolvedError);
		expect(calls).toHaveLength(1);
		expect(sleeps).toEqual([]);
	});

	it('accepts a lower rung in ladder order within a pass while the top rung has no match (documented drift)', async () => {
		const { resolver } = setup([
			{ role: 0, text: 1 },
			{ role: 1, text: 1 },
		]);
		expect(await resolver.resolve(target([role, text]), {}, 5_000)).toMatchObject({ rungIndex: 1, rungKind: 'text' });
	});

	it('waits for a frame that appears late', async () => {
		let appeared = false;
		const withFrame = fakeFrameTree({
			url: 'http://bank.test/',
			children: [{ name: 'content', url: 'http://bank.test/x' }],
		});
		const without = fakeFrameTree({ url: 'http://bank.test/' });
		let clock = 0;
		const resolver = new LadderResolver<FakeFrame, { count(): Promise<number> }>({
			root: () => (appeared ? withFrame : without),
			toLocator: () => ({ count: async () => 1 }),
			sleep: async (ms) => {
				clock += ms;
				if (clock >= 300) appeared = true;
			},
			now: () => clock,
		});
		expect(await resolver.resolve(target([role]), {}, 5_000)).toMatchObject({ rungIndex: 0 });
	});

	it('propagates a missing binding without retrying', async () => {
		const { resolver } = setup([{ label: 1 }]);
		const ladder: LocatorRung[] = [{ kind: 'label', text: '{{memberId}}', rationale }];
		const failing = new LadderResolver<FakeFrame, { count(): Promise<number> }>({
			root: () => fakeFrameTree({ url: 'http://x/' }),
			toLocator: () => {
				throw new BindingMissingError('memberId');
			},
			sleep: async () => undefined,
			now: () => 0,
		});
		await expect(failing.resolve(target(ladder, []), {})).rejects.toBeInstanceOf(BindingMissingError);
		expect(resolver).toBeDefined();
	});
});
