import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LeaseStateSchema, LeaseTransitionSchema } from './LeaseState.js';

const transition = {
	from: 'AGENT',
	to: 'PAUSED',
	actor: 'replay',
	reason: 'approval_required before s12-click-confirm',
	at: '2026-09-29T10:15:30.000Z',
	requestId: 'ir-20260929T101530-beef',
};

describe('LeaseStateSchema', () => {
	it('is exactly AGENT | PAUSED | HUMAN | RESUMING | CLOSED', () => {
		expect(LeaseStateSchema.options).toEqual(['AGENT', 'PAUSED', 'HUMAN', 'RESUMING', 'CLOSED']);
		expect(LeaseStateSchema.safeParse('agent').success).toBe(false);
	});
});

describe('LeaseTransitionSchema', () => {
	it('accepts a pause with a request id, and a cede by an operator without one', () => {
		expect(LeaseTransitionSchema.parse(transition)).toEqual(transition);
		const cede: Record<string, unknown> = { ...transition, from: 'PAUSED', to: 'HUMAN', actor: 'operator:ops-1' };
		delete cede.requestId;
		expect(LeaseTransitionSchema.safeParse(cede).success).toBe(true);
	});

	it('rejects a missing field, an unknown state, a bad actor and an unknown key', () => {
		const missing: Record<string, unknown> = { ...transition };
		delete missing.reason;
		expect(LeaseTransitionSchema.safeParse(missing).success).toBe(false);
		expect(LeaseTransitionSchema.safeParse({ ...transition, to: 'SUSPENDED' }).success).toBe(false);
		expect(LeaseTransitionSchema.safeParse({ ...transition, actor: 'Jane Sample' }).success).toBe(false);
		expect(LeaseTransitionSchema.safeParse({ ...transition, token: 'secret' }).success).toBe(false);
		expect(LeaseTransitionSchema.safeParse({ ...transition, at: 'yesterday' }).success).toBe(false);
	});

	it('exports to JSON Schema', () => {
		expect(() => z.toJSONSchema(LeaseTransitionSchema)).not.toThrow();
	});
});
