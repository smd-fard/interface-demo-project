import { FakeClock } from '@idp/evidence/testing';
import { describe, expect, it } from 'vitest';
import { DEFAULT_STOP_OPTIONS, StopConditions } from './StopConditions.js';

describe('StopConditions', () => {
	it('has the documented defaults', () => {
		expect(DEFAULT_STOP_OPTIONS).toEqual({
			maxSteps: 25,
			timeoutMs: 300_000,
			deadEndRepeats: 3,
			policyBlockedLimit: 3,
			unverifiedFinishLimit: 2,
		});
	});

	it('stops at max_steps once the turn budget is used', () => {
		const stops = new StopConditions({ maxSteps: 2, clock: new FakeClock() });
		expect(stops.beforeTurn()).toBeNull();
		stops.countTurn();
		expect(stops.beforeTurn()).toBeNull();
		stops.countTurn();
		expect(stops.beforeTurn()).toBe('max_steps');
		expect(stops.turns).toBe(2);
	});

	it('stops at timeout on the injected clock', () => {
		const clock = new FakeClock();
		const stops = new StopConditions({ timeoutMs: 1_000, clock });
		clock.advance(999);
		expect(stops.beforeTurn()).toBeNull();
		clock.advance(1);
		expect(stops.beforeTurn()).toBe('timeout');
	});

	// Expectation changed (review-fixes FR8): two no-op actions used to stop the run (before + after digests
	// filled the 3-entry window). Now it takes three consecutive no-progress turns.
	it('detects a dead end: three consecutive no-op actions', () => {
		const stops = new StopConditions({ clock: new FakeClock() });
		expect(stops.recordAction({ before: 'A', after: 'A', progress: false })).toBeNull();
		expect(stops.recordAction({ before: 'A', after: 'A', progress: false })).toBeNull();
		expect(stops.recordAction({ before: 'A', after: 'A', progress: false })).toBe('dead_end');
	});

	it('two no-op actions (e.g. Tab, Tab) are not a dead end', () => {
		const stops = new StopConditions({ clock: new FakeClock() });
		expect(stops.recordAction({ before: 'A', after: 'A', progress: false })).toBeNull();
		expect(stops.recordAction({ before: 'A', after: 'A', progress: false })).toBeNull();
		expect(stops.recordAction({ before: 'A', after: 'B', progress: false })).toBeNull();
		expect(stops.recordAction({ before: 'B', after: 'B', progress: false })).toBeNull();
		expect(stops.recordAction({ before: 'B', after: 'B', progress: false })).toBeNull();
	});

	it('value-only fills and selects on an unchanged screen are not no-progress turns', () => {
		const stops = new StopConditions({ clock: new FakeClock() });
		for (let index = 0; index < 5; index += 1) {
			expect(stops.recordAction({ before: 'A', after: 'A', progress: false, valueOnly: true })).toBeNull();
		}
		// They do not reset the count either: no-op clicks between fills still add up.
		expect(stops.recordAction({ before: 'A', after: 'A', progress: false })).toBeNull();
		expect(stops.recordAction({ before: 'A', after: 'A', progress: false, valueOnly: true })).toBeNull();
		expect(stops.recordAction({ before: 'A', after: 'A', progress: false })).toBeNull();
		expect(stops.recordAction({ before: 'A', after: 'A', progress: false })).toBe('dead_end');
	});

	it('progress (an extract, a declared output) resets the dead-end window', () => {
		const stops = new StopConditions({ clock: new FakeClock() });
		expect(stops.recordAction({ before: 'A', after: 'A', progress: false })).toBeNull();
		expect(stops.recordAction({ before: 'A', after: 'A', progress: false })).toBeNull();
		expect(stops.recordAction({ before: 'A', after: 'A', progress: true })).toBeNull();
		expect(stops.recordAction({ before: 'A', after: 'A', progress: false })).toBeNull();
		expect(stops.recordAction({ before: 'A', after: 'A', progress: false })).toBeNull();
		stops.recordProgress();
		expect(stops.recordAction({ before: 'A', after: 'A', progress: false })).toBeNull();
		expect(stops.recordAction({ before: 'A', after: 'A', progress: false })).toBeNull();
	});

	it('detects an A-B-A-B oscillation', () => {
		const stops = new StopConditions({ clock: new FakeClock() });
		expect(stops.recordAction({ before: 'A', after: 'B', progress: false })).toBeNull();
		expect(stops.recordAction({ before: 'B', after: 'A', progress: false })).toBeNull();
		expect(stops.recordAction({ before: 'A', after: 'B', progress: false })).toBe('dead_end');
	});

	it('a screen that keeps changing is not a dead end', () => {
		const stops = new StopConditions({ clock: new FakeClock() });
		for (const [before, after] of [
			['A', 'B'],
			['B', 'C'],
			['C', 'C'],
			['C', 'D'],
		] as const) {
			expect(stops.recordAction({ before, after, progress: false })).toBeNull();
		}
	});

	it('stops at policy_blocked after three consecutive denials; a performed action resets the count', () => {
		const stops = new StopConditions({ clock: new FakeClock() });
		expect(stops.recordDenial()).toBeNull();
		expect(stops.recordDenial()).toBeNull();
		stops.recordAction({ before: 'A', after: 'B', progress: false });
		expect(stops.recordDenial()).toBeNull();
		expect(stops.recordDenial()).toBeNull();
		expect(stops.recordDenial()).toBe('policy_blocked');
	});

	it('stops at goal_unverified after two finishes whose checkpoint did not hold', () => {
		const stops = new StopConditions({ clock: new FakeClock() });
		expect(stops.recordUnverifiedFinish()).toBeNull();
		expect(stops.recordUnverifiedFinish()).toBe('goal_unverified');
	});

	it('a handoff clears the dead-end window and the denial count', () => {
		const stops = new StopConditions({ clock: new FakeClock() });
		stops.recordAction({ before: 'A', after: 'A', progress: false });
		stops.recordAction({ before: 'A', after: 'A', progress: false });
		stops.recordDenial();
		stops.recordDenial();
		stops.resetAfterHandoff();
		expect(stops.recordAction({ before: 'A', after: 'A', progress: false })).toBeNull();
		expect(stops.recordAction({ before: 'A', after: 'A', progress: false })).toBeNull();
		expect(stops.recordDenial()).toBeNull();
	});

	it('rejects a non-positive budget', () => {
		expect(() => new StopConditions({ maxSteps: 0, clock: new FakeClock() })).toThrow(/maxSteps/);
	});
});
