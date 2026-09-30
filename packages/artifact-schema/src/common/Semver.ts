import { z } from 'zod';

// The official semver.org 2.0.0 pattern (numeric identifiers without leading zeros, optional pre-release and build).
const SEMVER_PATTERN =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export const SemverSchema = z
	.string()
	.regex(SEMVER_PATTERN)
	.describe('A semantic version (semver 2.0.0), e.g. "1.2.0" or "1.3.0-rc.1". No leading "v".');
export type Semver = z.infer<typeof SemverSchema>;
