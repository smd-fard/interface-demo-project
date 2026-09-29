import type { BoundaryViolation } from './BoundaryViolation.js';

/** Renders violations one per line: `<code> <rule>: <package> → <dependency> (<section>) — <message>`. */
export function formatViolations(violations: readonly BoundaryViolation[]): string {
	return violations
		.map((v) => `${v.code} ${v.rule}: ${v.package} → ${v.dependency} (${v.section ?? '-'}) — ${v.message}`)
		.join('\n');
}
