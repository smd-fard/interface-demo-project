import { catalogEntry } from './ConditionCatalog.js';
import type { ConditionMatch } from './detectConditions.js';
import type { DetectedCondition } from './DetectedCondition.js';
import { resolveCondition, type RuleSources } from './resolveRules.js';

/** A condition code to classify, with the signature match (if any) and the rule sources of the step. */
export interface ClassifyInput {
	readonly code: string;
	/** The rule whose signature matched; `null` for an engine-detected condition. */
	readonly match: ConditionMatch | null;
	readonly sources: RuleSources;
	/** The engine's description of what it saw (engine-detected conditions). */
	readonly detail?: string;
}

/**
 * Classifies a detected condition: a signature match carries its rule (artifact or profile); an engine-detected
 * code is resolved artifact rule → app profile → catalog default. `null` when nobody knows the code: the caller
 * fails loudly rather than guessing a class at runtime.
 */
export function classifyCondition({ code, match, sources, detail }: ClassifyInput): DetectedCondition | null {
	if (match !== null) {
		return {
			code,
			class: match.rule.class,
			source: match.rule.source,
			rule: match.rule,
			entry: catalogEntry(code),
			match,
			signal: `matched "${match.matchedText}"`,
		};
	}
	const resolved = resolveCondition(code, sources);
	if (resolved === null) return null;
	return {
		code,
		class: resolved.class,
		source: resolved.source,
		rule: resolved.rule,
		entry: resolved.entry,
		match: null,
		signal: detail ?? 'detected by the engine',
	};
}
