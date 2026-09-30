import { z } from 'zod';
import { FrameScopeSchema } from './FrameScope.js';
import { LocatorRungSchema } from './LocatorRung.js';

export const TargetRefSchema = z
	.strictObject({
		description: z
			.string()
			.min(1)
			.max(300)
			.describe(
				'Human-readable name of the target, e.g. "Search button in the member search form". Shown to operators and in failure reports.',
			),
		frame: FrameScopeSchema,
		ladder: z
			.array(LocatorRungSchema)
			.min(1)
			.max(5)
			.describe(
				'Locator rungs in stability order (most stable first). The resolver tries each in turn inside `frame`; resolving on a later rung succeeds but is reported as drift.',
			),
	})
	.describe('A UI element the artifact acts on or checks, independent of any one selector technology.');
export type TargetRef = z.infer<typeof TargetRefSchema>;
