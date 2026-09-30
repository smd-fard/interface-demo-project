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
		sleep: async () => undefined,
	});
	return { resolver, calls };
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

	it('propagates a missing binding without retrying', async () => {
		const { resolver } = setup([{ label: 1 }]);
		const ladder: LocatorRung[] = [{ kind: 'label', text: '{{memberId}}', rationale }];
		const failing = new LadderResolver<FakeFrame, { count(): Promise<number> }>({
			root: () => fakeFrameTree({ url: 'http://x/' }),
			toLocator: () => {
				throw new BindingMissingError('memberId');
			},
			sleep: async () => undefined,
		});
		await expect(failing.resolve(target(ladder, []), {})).rejects.toBeInstanceOf(BindingMissingError);
		expect(resolver).toBeDefined();
	});
});
