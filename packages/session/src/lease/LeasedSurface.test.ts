import { createRedactor } from '@idp/policy';
import { FakeSurface, fakeLocation } from '@idp/surface/testing';
import type { SurfaceAction } from '@idp/surface';
import { describe, expect, it } from 'vitest';
import { LeaseNotHeldError } from '../errors/LeaseNotHeldError.js';
import { ControlLease } from './ControlLease.js';
import { LeasedSurface } from './LeasedSurface.js';

const REQUEST = 'ir-20260929T101500-beef';
const OPS = 'operator:ops-1';
const origin = 'http://127.0.0.1:4010';
const click = (actor: SurfaceAction['actor']): SurfaceAction => ({
	kind: 'click',
	actor,
	target: { kind: 'ref', ref: 'e1' },
});

function setup(automationActor: 'agent' | 'replay' = 'agent') {
	const inner = new FakeSurface({ location: fakeLocation(origin, '/member/search') });
	const lease = new ControlLease({ automationActor });
	return { inner, lease, surface: new LeasedSurface(inner, lease) };
}

describe('LeasedSurface', () => {
	it('lets the automation act while AGENT', async () => {
		const { inner, surface } = setup('agent');
		await surface.act(click('agent'));
		await surface.act(click('replay'));
		expect(inner.acts).toHaveLength(2);
	});

	it.each(['PAUSED', 'HUMAN', 'RESUMING', 'CLOSED'] as const)(
		'refuses an automation act while %s with LeaseNotHeldError, without reaching the inner surface',
		async (state) => {
			const { inner, lease, surface } = setup('replay');
			await lease.pause('stuck', REQUEST);
			if (state === 'HUMAN' || state === 'RESUMING') await lease.cede(OPS);
			if (state === 'RESUMING') await lease.resume(OPS);
			if (state === 'CLOSED') await lease.close('replay');
			expect(lease.state()).toBe(state);
			const error = await surface.act(click('replay')).catch((caught: unknown) => caught);
			expect(error).toBeInstanceOf(LeaseNotHeldError);
			expect(error).toMatchObject({ code: 'LEASE_NOT_HELD', actor: 'replay', state });
			expect(inner.acts).toHaveLength(0);
		},
	);

	it('lets a human act only while HUMAN', async () => {
		const { inner, lease, surface } = setup();
		await expect(surface.act(click('human'))).rejects.toBeInstanceOf(LeaseNotHeldError);
		await lease.pause('stuck', REQUEST);
		await expect(surface.act(click('human'))).rejects.toBeInstanceOf(LeaseNotHeldError);
		await lease.cede(OPS);
		await surface.act(click('human'));
		expect(inner.acts).toHaveLength(1);
		await lease.resume(OPS);
		await expect(surface.act(click('human'))).rejects.toBeInstanceOf(LeaseNotHeldError);
		expect(inner.acts).toHaveLength(1);
	});

	it('always allows observation, whatever the lease state', async () => {
		const { lease, surface } = setup();
		await lease.pause('stuck', REQUEST);
		await lease.cede(OPS);
		expect((await surface.observe()).url).toBe(`${origin}/`);
		expect((await surface.location()).frames).toHaveLength(2);
		expect(await surface.check({ kind: 'text_present', text: 'Member Search' }, {}, 0)).toEqual({ kind: 'held' });
		expect(surface.pendingDialog()).toBeNull();
		const evidence = await surface.captureEvidence(createRedactor({ sensitiveValues: [] }));
		expect(evidence.url).toBe(`${origin}/`);
		expect(await surface.describe({ kind: 'ref', ref: 'e1' })).toMatchObject({ name: 'Search' });
	});

	it('close closes the inner surface', async () => {
		const { inner, surface } = setup();
		await surface.close();
		expect(inner.closed).toBe(true);
	});
});
