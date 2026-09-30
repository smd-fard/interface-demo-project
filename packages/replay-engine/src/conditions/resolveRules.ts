import type { ConditionClass, OutcomeRule } from '@idp/artifact-schema';
import { catalogEntry, type ConditionCatalogEntry } from './ConditionCatalog.js';

/** An outcome rule that applies at a step, with where it came from. */
export type ResolvedRule = Pick<
	OutcomeRule,
	'code' | 'class' | 'description' | 'signature' | 'message' | 'recovery'
> & {
	readonly source: 'artifact' | 'profile';
};

/** The artifact and profile rules, and the step they are resolved for. */
export interface RuleSources {
	/** The artifact's `outcomeRules` (scoped). */
	readonly artifactRules: readonly OutcomeRule[];
	/** The app profile's `conditions` (always `any_step`). */
	readonly profileRules: readonly OutcomeRule[];
	/** The step being checked; `null` for the artifact's success condition (only `any_step` rules apply). */
	readonly stepId: string | null;
}

function inScope(rule: OutcomeRule, stepId: string | null): boolean {
	if (rule.scope === 'any_step') return true;
	return stepId !== null && rule.scope.includes(stepId);
}

function resolved(rule: OutcomeRule, source: ResolvedRule['source']): ResolvedRule {
	return {
		code: rule.code,
		class: rule.class,
		description: rule.description,
		signature: rule.signature,
		...(rule.message === undefined ? {} : { message: rule.message }),
		...(rule.recovery === undefined ? {} : { recovery: rule.recovery }),
		source,
	};
}

/**
 * The rules that apply at a step, in evaluation order: the artifact's rules first, then the profile's. An artifact
 * rule overrides the profile rule with the same code everywhere — its scope says where the artifact wants the
 * condition checked (e.g. not-found only after the Search click), so the profile default does not re-add it
 * elsewhere. Codes neither declares have no signature; their class comes from the catalog (`resolveCondition`).
 */
export function resolveRules({ artifactRules, profileRules, stepId }: RuleSources): ResolvedRule[] {
	const overridden = new Set(artifactRules.map((rule) => rule.code));
	return [
		...artifactRules.filter((rule) => inScope(rule, stepId)).map((rule) => resolved(rule, 'artifact')),
		...profileRules
			.filter((rule) => !overridden.has(rule.code) && inScope(rule, stepId))
			.map((rule) => resolved(rule, 'profile')),
	];
}

/** How one condition code is classified at a step. */
export interface ResolvedCondition {
	readonly code: string;
	readonly class: ConditionClass;
	readonly source: 'artifact' | 'profile' | 'catalog';
	/** The applying rule, or `null` when the class is the catalog default. */
	readonly rule: ResolvedRule | null;
	readonly entry: ConditionCatalogEntry | null;
}

/**
 * Classifies a condition code at a step: artifact rule → app profile → catalog default. `null` when none of them
 * knows the code: the caller fails loudly rather than guessing a class at runtime.
 */
export function resolveCondition(code: string, sources: RuleSources): ResolvedCondition | null {
	const rule = resolveRules(sources).find((candidate) => candidate.code === code) ?? null;
	const entry = catalogEntry(code);
	if (rule !== null) return { code, class: rule.class, source: rule.source, rule, entry };
	if (entry !== null) return { code, class: entry.defaultClass, source: 'catalog', rule: null, entry };
	return null;
}
