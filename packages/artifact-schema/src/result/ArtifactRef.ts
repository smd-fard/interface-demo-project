import { z } from 'zod';
import { CapabilityIdSchema, ContentHashSchema } from '../common/Identifiers.js';
import { SemverSchema } from '../common/Semver.js';

export const ArtifactRefSchema = z
	.strictObject({
		id: CapabilityIdSchema,
		version: SemverSchema.describe('Version of the capability that ran.'),
		contentHash: ContentHashSchema.describe('contentHash of the exact artifact document that ran.'),
	})
	.describe('Identifies the exact capability artifact a run used, without embedding it.');
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
