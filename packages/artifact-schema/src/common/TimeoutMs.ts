import { z } from 'zod';

export const TimeoutMsSchema = z
	.int()
	.min(1)
	.max(300_000)
	.describe('A timeout in whole milliseconds (1 ms to 5 minutes). Overrides the engine default for this item.');
export type TimeoutMs = z.infer<typeof TimeoutMsSchema>;
