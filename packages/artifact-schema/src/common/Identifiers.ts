import { z } from 'zod';

/**
 * Stable identifiers used across the contract. Each is a pattern-validated string so that ids stay readable in
 * logs and evidence, and so that a concrete sensitive value (a member number, a password) can never pass as one.
 */

const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const CAMEL = /^[a-z][a-zA-Z0-9]*$/;
const SNAKE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

export const CapabilityIdSchema = z
	.string()
	.max(64)
	.regex(KEBAB)
	.describe('Capability id: a lowercase kebab-case slug, e.g. "member-lookup". Stable across artifact versions.');
export type CapabilityId = z.infer<typeof CapabilityIdSchema>;

export const StepIdSchema = z
	.string()
	.max(64)
	.regex(/^s\d{2,3}-[a-z0-9]+(?:-[a-z0-9]+)*$/)
	.describe(
		'Step id: "s<NN>-<slug>", e.g. "s03-click-search". Assigned once by the compiler and kept stable when steps are edited or inserted, so evidence, drift reports and outcome-rule scopes keep pointing at the same step.',
	);
export type StepId = z.infer<typeof StepIdSchema>;

export const ParamNameSchema = z
	.string()
	.max(64)
	.regex(CAMEL)
	.describe('Parameter name: a camelCase identifier, e.g. "memberId". Referenced from templates as {{memberId}}.');
export type ParamName = z.infer<typeof ParamNameSchema>;

export const OutputNameSchema = z
	.string()
	.max(64)
	.regex(CAMEL)
	.describe('Output name: a camelCase identifier, e.g. "savingsBalance". Keys the success result outputs record.');
export type OutputName = z.infer<typeof OutputNameSchema>;

export const OutcomeCodeSchema = z
	.string()
	.max(64)
	.regex(SNAKE)
	.describe('Outcome/condition code: snake_case, e.g. "member_not_found". Stable; calling agents branch on it.');
export type OutcomeCode = z.infer<typeof OutcomeCodeSchema>;

export const CredentialRefSchema = z
	.string()
	.max(64)
	.regex(KEBAB)
	.describe(
		'Name of a credential held outside the artifact (resolved at run time from the environment/secret store), e.g. "mockbank-operator". It is a reference, never the secret itself.',
	);
export type CredentialRef = z.infer<typeof CredentialRefSchema>;

export const RunKindSchema = z
	.enum(['discovery', 'replay'])
	.describe('What produced a run: an LLM-driven discovery run or a deterministic replay run.');
export type RunKind = z.infer<typeof RunKindSchema>;

const TIMESTAMP = '\\d{8}T\\d{6}';

export const RunIdSchema = z
	.string()
	.regex(new RegExp(`^(?:discovery|replay)-${TIMESTAMP}-[0-9a-f]{4}$`))
	.describe(
		'Run id: "<kind>-<yyyymmddThhmmss>-<4hex>" with kind discovery|replay and a UTC timestamp, e.g. "replay-20260929T101500-a1b2". Names the run evidence directory.',
	);
export type RunId = z.infer<typeof RunIdSchema>;

export const InterventionIdSchema = z
	.string()
	.regex(new RegExp(`^ir-${TIMESTAMP}-[0-9a-f]{4}$`))
	.describe(
		'Intervention-request id: "ir-<yyyymmddThhmmss>-<4hex>" (UTC timestamp + 4 lowercase hex), e.g. "ir-20260929T101500-beef".',
	);
export type InterventionId = z.infer<typeof InterventionIdSchema>;

export const ContentHashSchema = z
	.string()
	.regex(/^sha256:[0-9a-f]{64}$/)
	.describe(
		'"sha256:<64 lowercase hex>" over the canonical JSON of the artifact with contentHash excluded (keys sorted recursively). Detects any edit to a persisted artifact.',
	);
export type ContentHash = z.infer<typeof ContentHashSchema>;

export const VendorAppIdSchema = z
	.string()
	.max(64)
	.regex(KEBAB)
	.describe(
		'Vendor application id: a lowercase kebab-case slug naming the legacy product, e.g. "coreone". Independent of the tenant.',
	);
export type VendorAppId = z.infer<typeof VendorAppIdSchema>;

export const TenantIdSchema = z
	.string()
	.max(64)
	.regex(KEBAB)
	.describe(
		'Tenant/variant id: a lowercase kebab-case slug naming one institution\'s deployment of a vendor app, e.g. "tenant-a". Tenants of the same app can differ in labels and layout (R7.2).',
	);
export type TenantId = z.infer<typeof TenantIdSchema>;
