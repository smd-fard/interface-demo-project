import { z } from 'zod';

const OPERATOR = /^operator:[a-z0-9][a-z0-9._-]{0,63}$/;

export const OperatorActorSchema = z
	.string()
	.regex(OPERATOR)
	.describe(
		'A human operator: "operator:<handle>", e.g. "operator:ops-1". The handle is an opaque lowercase login handle, never a person\'s name or e-mail.',
	);
export type OperatorActor = z.infer<typeof OperatorActorSchema>;

export const ActorSchema = z
	.union([
		z.literal('agent').describe('The LLM discovery loop.'),
		z.literal('replay').describe('The deterministic replay engine.'),
		OperatorActorSchema,
	])
	.describe('Who acted: "agent" (discovery), "replay" (deterministic replay) or "operator:<handle>" (a human).');
export type Actor = z.infer<typeof ActorSchema>;
