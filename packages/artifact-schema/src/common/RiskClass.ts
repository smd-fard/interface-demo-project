import { z } from 'zod';

/** Risk classes in ascending order. The index is the rank used by {@link maxRisk}. */
export const RISK_ORDER = ['read', 'reversible', 'irreversible'] as const;

export const RiskClassSchema = z
	.enum(RISK_ORDER)
	.describe(
		'Risk class of an action: read (observes only), reversible (changes state that can be undone, e.g. typing into a field), irreversible (commits a business change, e.g. Confirm). Policy gates on it; replay recomputes it and never lowers it.',
	);
export type RiskClass = z.infer<typeof RiskClassSchema>;

/** The highest of the given risk classes. Pure. */
export function maxRisk(first: RiskClass, ...rest: RiskClass[]): RiskClass {
	let highest = first;
	for (const risk of rest) {
		if (RISK_ORDER.indexOf(risk) > RISK_ORDER.indexOf(highest)) highest = risk;
	}
	return highest;
}
