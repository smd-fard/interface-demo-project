import { LeaseTransitionSchema, type LeaseState, type LeaseTransition } from '@idp/artifact-schema';
import { FakeClock } from '@idp/evidence/testing';
import { describe, expect, it } from 'vitest';
import { IllegalLeaseTransitionError } from '../errors/IllegalLeaseTransitionError.js';
import { SessionValidationError } from '../errors/SessionValidationError.js';
import { ControlLease } from './ControlLease.js';

const REQUEST = 'ir-20260929T101500-beef';
const OPS = 'operator:ops-1';

function lease(automationActor: 'agent' | 'replay' = 'replay', clock = new FakeClock()): ControlLease {
	return new ControlLease({ automationActor, clock });
}

/** Drives a fresh lease into `state` through legal transitions. */
async function leaseIn(state: LeaseState): Promise<ControlLease> {
	const l = lease();
	if (state === 'AGENT') return l;
	await l.pause('approval_required', REQUEST);
	if (state === 'PAUSED') return l;
	if (state === 'CLOSED') {
		await l.close(OPS, 'operator aborted');
		return l;
	}
	await l.cede(OPS);
	if (state === 'HUMAN') return l;
	await l.resume(OPS);
	return l;
}

const path = (history: readonly LeaseTransition[]) => history.map((t) => `${t.from}->${t.to}`);

describe('ControlLease', () => {
	it('starts in AGENT, held by the automation, with an empty history', () => {
		const l = lease();
		expect(l.state()).toBe('AGENT');
		expect(l.holder()).toBe('agent');
		expect(l.operator()).toBeNull();
		expect(l.history()).toEqual([]);
	});

	it('walks the takeover path AGENT → PAUSED → HUMAN → RESUMING → AGENT and records it in order', async () => {
		const clock = new FakeClock();
		const l = lease('replay', clock);
		expect(await l.pause('target_unresolved', REQUEST)).toBe('PAUSED');
		expect(l.holder()).toBe('none');
		clock.advance(1_000);
		expect(await l.cede(OPS)).toBe('HUMAN');
		expect(l.holder()).toBe('human');
		expect(l.operator()).toBe(OPS);
		expect(await l.resume(OPS)).toBe('RESUMING');
		expect(l.holder()).toBe('none');
		expect(await l.reacquire()).toBe('AGENT');
		expect(l.holder()).toBe('agent');

		const history = l.history();
		expect(path(history)).toEqual(['AGENT->PAUSED', 'PAUSED->HUMAN', 'HUMAN->RESUMING', 'RESUMING->AGENT']);
		expect(history.map((t) => t.actor)).toEqual(['replay', OPS, OPS, 'replay']);
		expect(history.every((t) => t.requestId === REQUEST)).toBe(true);
		expect(history[0]?.reason).toBe('target_unresolved');
		expect(history[0]?.at).toBe('2026-09-29T10:15:00.000Z');
		expect(history[1]?.at).toBe('2026-09-29T10:15:01.000Z');
		for (const transition of history) expect(LeaseTransitionSchema.safeParse(transition).success).toBe(true);
	});

	it('walks the approval path AGENT → PAUSED → RESUMING → AGENT', async () => {
		const l = lease('agent');
		await l.pause('approval_required', REQUEST);
		expect(await l.approve(OPS, REQUEST)).toBe('RESUMING');
		expect(await l.reacquire()).toBe('AGENT');
		expect(path(l.history())).toEqual(['AGENT->PAUSED', 'PAUSED->RESUMING', 'RESUMING->AGENT']);
		expect(l.history().map((t) => t.actor)).toEqual(['agent', OPS, 'agent']);
	});

	it('reject closes the lease: PAUSED → CLOSED', async () => {
		const l = await leaseIn('PAUSED');
		expect(await l.reject(OPS)).toBe('CLOSED');
		expect(l.holder()).toBe('none');
		expect(l.history().at(-1)).toMatchObject({ from: 'PAUSED', to: 'CLOSED', actor: OPS, requestId: REQUEST });
	});

	it.each<LeaseState>(['AGENT', 'PAUSED', 'HUMAN', 'RESUMING'])('close is legal from %s', async (state) => {
		const l = await leaseIn(state);
		expect(await l.close(OPS, 'operator aborted')).toBe('CLOSED');
		expect(l.history().at(-1)).toMatchObject({ from: state, to: 'CLOSED', actor: OPS, reason: 'operator aborted' });
	});

	it('close from CLOSED is a no-op (nothing recorded)', async () => {
		const l = await leaseIn('CLOSED');
		const before = l.history().length;
		expect(await l.close('replay')).toBe('CLOSED');
		expect(l.history()).toHaveLength(before);
	});

	type Op = 'pause' | 'cede' | 'approve' | 'reject' | 'resume' | 'reacquire';
	const run = (l: ControlLease, op: Op): Promise<LeaseState> => {
		switch (op) {
			case 'pause':
				return l.pause('stuck', REQUEST);
			case 'cede':
				return l.cede(OPS);
			case 'approve':
				return l.approve(OPS, REQUEST);
			case 'reject':
				return l.reject(OPS);
			case 'resume':
				return l.resume(OPS);
			case 'reacquire':
				return l.reacquire();
		}
	};
	const legal: Record<Op, LeaseState> = {
		pause: 'AGENT',
		cede: 'PAUSED',
		approve: 'PAUSED',
		reject: 'PAUSED',
		resume: 'HUMAN',
		reacquire: 'RESUMING',
	};
	const target: Record<Op, LeaseState> = {
		pause: 'PAUSED',
		cede: 'HUMAN',
		approve: 'RESUMING',
		reject: 'CLOSED',
		resume: 'RESUMING',
		reacquire: 'AGENT',
	};
	const states: LeaseState[] = ['AGENT', 'PAUSED', 'HUMAN', 'RESUMING', 'CLOSED'];
	const illegal = (Object.keys(legal) as Op[]).flatMap((op) =>
		states.filter((state) => state !== legal[op]).map((state) => [op, state] as const),
	);

	it.each(illegal)('%s from %s is illegal and changes nothing', async (op, state) => {
		const l = await leaseIn(state);
		const before = l.history().length;
		const error = await run(l, op).then(
			() => undefined,
			(caught: unknown) => caught,
		);
		// A duplicate of the transition just applied is idempotent, not illegal.
		const last = l.history().at(-1);
		const duplicate = last !== undefined && last.from === legal[op] && last.to === target[op] && state === target[op];
		if (duplicate) {
			expect(error).toBeUndefined();
		} else {
			expect(error).toBeInstanceOf(IllegalLeaseTransitionError);
			expect(error).toMatchObject({ code: 'ILLEGAL_LEASE_TRANSITION', from: state, attempted: op });
		}
		expect(l.state()).toBe(state);
		expect(l.history()).toHaveLength(before);
	});

	it('a double resume is idempotent: one HUMAN → RESUMING transition, both calls resolve to RESUMING', async () => {
		const l = await leaseIn('HUMAN');
		const [first, second] = await Promise.all([l.resume(OPS), l.resume('operator:ops-2')]);
		expect([first, second]).toEqual(['RESUMING', 'RESUMING']);
		expect(path(l.history()).filter((p) => p === 'HUMAN->RESUMING')).toHaveLength(1);
	});

	it('a double reacquire yields exactly one RESUMING → AGENT transition', async () => {
		const l = await leaseIn('RESUMING');
		await Promise.all([l.reacquire(), l.reacquire()]);
		expect(l.state()).toBe('AGENT');
		expect(path(l.history()).filter((p) => p === 'RESUMING->AGENT')).toHaveLength(1);
	});

	it('a resume racing a pause is serialized in call order: pause applies, the resume from PAUSED is illegal', async () => {
		const l = lease();
		const pause = l.pause('stuck', REQUEST);
		const resume = l.resume(OPS);
		await expect(pause).resolves.toBe('PAUSED');
		await expect(resume).rejects.toBeInstanceOf(IllegalLeaseTransitionError);
		expect(path(l.history())).toEqual(['AGENT->PAUSED']);
	});

	it('a resume queued before a pause is illegal from AGENT; the pause still applies after it', async () => {
		const l = lease();
		const resume = l.resume(OPS);
		const pause = l.pause('stuck', REQUEST);
		await expect(resume).rejects.toBeInstanceOf(IllegalLeaseTransitionError);
		await expect(pause).resolves.toBe('PAUSED');
		expect(l.state()).toBe('PAUSED');
	});

	it('notifies listeners of each transition in order, and stops after unsubscribe', async () => {
		const l = lease();
		const seen: string[] = [];
		const off = l.onChange((transition) => seen.push(`${transition.from}->${transition.to}`));
		await l.pause('stuck', REQUEST);
		await l.cede(OPS);
		off();
		await l.resume(OPS);
		expect(seen).toEqual(['AGENT->PAUSED', 'PAUSED->HUMAN']);
	});

	it('the listener sees the new state already applied', async () => {
		const l = lease();
		let observed: LeaseState | undefined;
		l.onChange(() => {
			observed = l.state();
		});
		await l.pause('stuck', REQUEST);
		expect(observed).toBe('PAUSED');
	});

	it('refuses a malformed operator actor or an empty reason with SessionValidationError', async () => {
		const l = await leaseIn('PAUSED');
		await expect(l.cede('Jane Sample' as never)).rejects.toBeInstanceOf(SessionValidationError);
		await expect(lease().pause('', REQUEST)).rejects.toBeInstanceOf(SessionValidationError);
		expect(l.state()).toBe('PAUSED');
	});

	it('truncates an over-long reason to the contract limit', async () => {
		const l = lease();
		await l.pause('x'.repeat(900), REQUEST);
		expect(l.history()[0]?.reason).toHaveLength(500);
	});

	it('history() returns a copy', async () => {
		const l = await leaseIn('PAUSED');
		(l.history() as LeaseTransition[]).pop();
		expect(l.history()).toHaveLength(1);
	});
});
