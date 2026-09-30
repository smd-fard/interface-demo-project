import { z } from 'zod';

/**
 * The semver of the public artifact contract. Patch: docs only. Minor: a new optional field or a new union
 * member. Major: a removed/renamed field, a changed meaning, or a newly required field.
 */
export const SCHEMA_VERSION = '1.0.0' as const;

export const SchemaVersionSchema = z
	.literal(SCHEMA_VERSION)
	.describe(
		'Semver of the capability-artifact contract this document was written against. A loader accepts only the version it was built for; a mismatch is rejected rather than guessed at.',
	);
export type SchemaVersion = z.infer<typeof SchemaVersionSchema>;
