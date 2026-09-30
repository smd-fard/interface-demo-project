import type { SurfaceAction } from '@idp/surface';
import { FakeSurface, fakeLocation } from '@idp/surface/testing';
import { describe, expect, it } from 'vitest';
import { AutomationGateSurface, type AutomationGate } from './AutomationGateSurface.js';

const origin = 'http://127.0.0.1:4010';
const click = (actor: SurfaceAction['actor']): SurfaceAction => ({
	kind: 'click',
	actor,
	target: { kind: 'ref', ref: 'e1' },
});

function setup() {
	const inner = new FakeSurface({ location: fakeLocation(origin, '/member/search') });
	const events: string[] = [];
	const gate: AutomationGate = {
		automationAct: async (run) => {
			events.push('open');
			try {
				return await run();
			} finally {
				events.push('close');
			}
		},
	};
	return { inner, events, surface: new AutomationGateSurface(inner, gate) };
}

describe('AutomationGateSurface', () => {
	it.each(['agent', 'replay'] as const)('opens the page for exactly one %s act', async (actor) => {
		const { inner, events, surface } = setup();
		await surface.act(click(actor));
		expect(events).toEqual(['open', 'close']);
		expect(inner.acts).toHaveLength(1);
	});

	it('never opens the page for a human act (the recorder mediates those)', async () => {
		const { inner, events, surface } = setup();
		await surface.act(click('human'));
		expect(events).toEqual([]);
		expect(inner.acts).toHaveLength(1);
	});

	it('observation passes straight through', async () => {
		const { events, surface } = setup();
		await surface.observe();
		await surface.location();
		expect(surface.pendingDialog()).toBeNull();
		expect(events).toEqual([]);
	});
});
