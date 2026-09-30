import { EvidenceValidationError, type EvidenceIssue } from '../errors/EvidenceValidationError.js';

/** The part of a Zod schema this package needs; keeps `zod` out of the runtime dependencies. */
export interface SafeParser<T> {
	safeParse(
		data: unknown,
	): { success: true; data: T } | { success: false; error: { issues: readonly EvidenceIssue[] } };
}

/** Validates `data` with `schema`, throwing `EvidenceValidationError` (EVIDENCE_INVALID) on failure. */
export function parseOrThrow<T>(schema: SafeParser<T>, data: unknown, what: string): T {
	const parsed = schema.safeParse(data);
	if (!parsed.success) throw new EvidenceValidationError(`invalid ${what}`, parsed.error.issues);
	return parsed.data;
}
