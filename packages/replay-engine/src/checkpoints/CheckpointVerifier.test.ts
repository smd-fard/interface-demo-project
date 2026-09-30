import type { Checkpoint } from '@idp/artifact-schema';
import { FakeSurface, fakeLocation, fakeObservation } from '@idp/surface/testing';
import { describe, expect, it, vi } from 'vitest';
import { CheckpointVerifier } from './CheckpointVerifier.js';

const ORIGIN = 'http://127.0.0.1:4010';
const checkpoint: Checkpoint = { kind: 'text_present', text: 'Member Inquiry' };
const notHeld = { kind: 'not_held', observed: 'text "Member Inquiry" not present' } as const;

describe('CheckpointVerifier', () => {
	it('held: one check with the whole timeout when there is no detector', async () => {
		const surface = new FakeSurface({ location: fakeLocation(ORIGIN, '/member/detail') });
		const check = vi.spyOn(surface, 'check');
		const observe = vi.spyOn(surface, 'observe');
		const verdict = await new CheckpointVerifier({ surface }).verify(checkpoint, { memberId: '1' }, 5000);
		expect(verdict).toEqual({ kind: 'held' });
		expect(check).toHaveBeenCalledTimes(1);
		expect(check).toHaveBeenCalledWith(checkpoint, { memberId: '1' }, 5000);
		expect(observe).not.toHaveBeenCalled();
	});

	it('not held: a timeout with what the surface observed', async () => {
		const surface = new FakeSurface({ location: fakeLocation(ORIGIN, '/member/search'), checks: [notHeld] });
		const verdict = await new CheckpointVerifier({ surface }).verify(checkpoint, {}, 5000);
		expect(verdict).toEqual({ kind: 'timeout', observed: notHeld.observed });
	});

	it('races the condition detector: a detected condition wins over the checkpoint', async () => {
		const surface = new FakeSurface({
			location: fakeLocation(ORIGIN, '/member/search'),
			observations: [
				fakeObservation(`${ORIGIN}/`),
				fakeObservation(`${ORIGIN}/`, { title: 'No records match your search criteria' }),
			],
			checks: [notHeld],
		});
		const detect = (observation: { title: string }) =>
			observation.title.includes('No records') ? 'member_not_found' : null;
		const verdict = await new CheckpointVerifier({ surface, detect, sliceMs: 250 }).verify(checkpoint, {}, 5000);
		expect(verdict).toEqual({ kind: 'condition', code: 'member_not_found' });
	});

	it('is bounded: with a detector it polls at most ceil(timeout / slice) times', async () => {
		const surface = new FakeSurface({ location: fakeLocation(ORIGIN, '/member/search'), checks: [notHeld] });
		const check = vi.spyOn(surface, 'check');
		const verdict = await new CheckpointVerifier({ surface, detect: () => null, sliceMs: 250 }).verify(
			checkpoint,
			{},
			1000,
		);
		expect(verdict).toEqual({ kind: 'timeout', observed: notHeld.observed });
		expect(check).toHaveBeenCalledTimes(4);
		for (const call of check.mock.calls as unknown[][]) expect(call[2]).toBe(250);
	});
});
