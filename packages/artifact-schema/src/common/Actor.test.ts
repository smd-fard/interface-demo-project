import { describe, expect, it } from 'vitest';
import { ActorSchema, OperatorActorSchema } from './Actor.js';

describe('ActorSchema', () => {
	it.each(['agent', 'replay', 'operator:ops-1', 'operator:jdoe'])('accepts %s', (actor) => {
		expect(ActorSchema.safeParse(actor).success).toBe(true);
	});
	it.each(['human', 'operator:', 'operator:Jane Sample', 'Agent', 'operator:a@b.test', 'system'])(
		'rejects %j',
		(actor) => {
			expect(ActorSchema.safeParse(actor).success).toBe(false);
		},
	);
	it('OperatorActorSchema accepts only operators', () => {
		expect(OperatorActorSchema.safeParse('operator:ops-1').success).toBe(true);
		expect(OperatorActorSchema.safeParse('agent').success).toBe(false);
	});
});
