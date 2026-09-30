import { z } from 'zod';

/**
 * Every action a step, an agent tool call or a recorded human action can perform. Each kind has exactly one
 * policy entry (risk class + allowlist key) in `@idp/policy`; a kind without one cannot run (invariant 2).
 */
export const ACTION_KINDS = [
	'navigate',
	'click',
	'fill',
	'select',
	'press',
	'extract',
	'wait',
	'dismiss_dialog',
] as const;

/** The kinds that can change the screen, so a step of one of these kinds must carry a checkpoint (invariant 5). */
export const SCREEN_CHANGING_KINDS = ['navigate', 'click', 'press', 'select', 'dismiss_dialog'] as const;

export const ActionKindSchema = z
	.enum(ACTION_KINDS)
	.describe('The kind of action a step performs. Discriminates the Step union.');
export type ActionKind = z.infer<typeof ActionKindSchema>;
