import { z } from 'zod';

export const EvidenceIdSchema = z
	.string()
	.max(64)
	.regex(/^[a-z0-9][a-z0-9]*(?:-[a-z0-9]+)*$/)
	.describe('Evidence id: a lowercase kebab-case slug unique within the run, e.g. "screenshot-0003".');
export type EvidenceId = z.infer<typeof EvidenceIdSchema>;

// Segments start with a letter, digit or underscore, so "." and ".." (and hidden files) cannot appear.
const SEGMENT = '[A-Za-z0-9_][A-Za-z0-9._-]*';

export const RunRelativePathSchema = z
	.string()
	.max(300)
	.regex(new RegExp(`^${SEGMENT}(?:/${SEGMENT})*$`))
	.describe(
		'A POSIX path relative to the run directory, e.g. "screenshots/0003-s06-click-search.png". No leading "/", no "." or ".." segment, no backslash, no scheme: evidence can never point outside its run.',
	);
export type RunRelativePath = z.infer<typeof RunRelativePathSchema>;

export const EvidenceKindSchema = z
	.enum(['screenshot', 'a11y_snapshot', 'trace', 'json', 'log'])
	.describe(
		'What the evidence file holds: a masked screenshot, a redacted accessibility snapshot, a Playwright trace (local only), a redacted JSON document, or a redacted log.',
	);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export const EvidenceRefSchema = z
	.strictObject({
		id: EvidenceIdSchema,
		kind: EvidenceKindSchema,
		path: RunRelativePathSchema,
		sha256: z
			.string()
			.regex(/^[0-9a-f]{64}$/)
			.describe('SHA-256 of the stored file bytes, as 64 lowercase hex characters. Detects tampering.'),
		redacted: z
			.literal(true)
			.describe(
				'Always true: the file passed the redaction layer (or screenshot masking) before it was stored. A literal, so an unredacted ref cannot be represented (invariant 3).',
			),
		localOnly: z
			.boolean()
			.describe(
				'true for files that stay on the machine that produced them (e.g. traces, which cannot be fully masked); they are never copied into shared evidence.',
			),
	})
	.describe('A pointer to one stored evidence file of a run. The contract carries refs, never the evidence content.');
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
