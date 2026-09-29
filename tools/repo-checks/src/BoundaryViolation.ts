import type { DependencySection } from './WorkspaceGraph.js';

/** Stable violation codes → human rule names. Codes never change meaning; new rules get new codes. */
export const BOUNDARY_RULES = {
	BND001: 'layer-direction',
	BND002: 'cycle',
	BND003: 'mock-bank-isolation',
	BND004: 'playwright-owner',
	BND005: 'anthropic-owner',
	BND006: 'forbidden-reach',
	BND007: 'runtime-allowlist',
	BND008: 'unknown-workspace',
	BND009: 'tooling-misuse',
} as const;

/** A stable boundary rule code. */
export type BoundaryCode = keyof typeof BOUNDARY_RULES;

/** One boundary finding against a workspace manifest. */
export interface BoundaryViolation {
	readonly code: BoundaryCode;
	/** Human rule name, `BOUNDARY_RULES[code]`. */
	readonly rule: (typeof BOUNDARY_RULES)[BoundaryCode];
	/** The workspace the finding is reported against. */
	readonly package: string;
	/** The offending dependency (for BND008 on a workspace itself: the workspace name). */
	readonly dependency: string;
	/** The manifest field of the (first) offending edge; `null` when no single field applies. */
	readonly section: DependencySection | null;
	/** Edge chain for transitive findings (cycles, forbidden reach); `[package, dependency]` otherwise. */
	readonly path: readonly string[];
	readonly message: string;
}
