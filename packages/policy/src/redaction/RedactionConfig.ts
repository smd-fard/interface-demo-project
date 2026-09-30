import type { PolicyConfig } from '@idp/artifact-schema';

/** The redaction section of a policy config: regex patterns with mask styles, and literal terms. */
export type RedactionConfig = PolicyConfig['redaction'];
