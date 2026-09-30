import { z } from 'zod';

/** The kinds of the LocatorRung union, for reports that name which rung matched (drift, run log). */
export const LOCATOR_RUNG_KINDS = ['role', 'label', 'text', 'structural'] as const;

export const LocatorRungKindSchema = z
	.enum(LOCATOR_RUNG_KINDS)
	.describe('The kind of a locator-ladder rung: role, label, text or structural.');
export type LocatorRungKind = z.infer<typeof LocatorRungKindSchema>;
