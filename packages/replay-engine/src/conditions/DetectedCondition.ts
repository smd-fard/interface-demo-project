import type { ConditionClass } from '@idp/artifact-schema';
import type { ConditionCatalogEntry } from './ConditionCatalog.js';
import type { ConditionMatch } from './detectConditions.js';
import type { ResolvedRule } from './resolveRules.js';

/**
 * A runtime condition the step runner has classified (artifact rule → app profile → catalog default) and is about
 * to respond to. `match` is set when a rule's signature matched; an engine-detected condition (an unrecognised
 * dialog, a slow load, a load that ran out of its budget) has none.
 */
export interface DetectedCondition {
	readonly code: string;
	readonly class: ConditionClass;
	readonly source: 'artifact' | 'profile' | 'catalog';
	/** The applying rule (its recovery and message target), or `null` when the class is the catalog default. */
	readonly rule: ResolvedRule | null;
	readonly entry: ConditionCatalogEntry | null;
	readonly match: ConditionMatch | null;
	/**
	 * What was seen, for `observed`: the matched signature text (e.g. `"Server Error"`, `HTTP 503`) or the engine's
	 * description. Never raw screen text or a dialog message; still redacted before any sink.
	 */
	readonly signal: string;
}
