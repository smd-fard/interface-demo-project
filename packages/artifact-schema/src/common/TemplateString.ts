import { z } from 'zod';

// Plain text without braces, interleaved with {{camelCaseParam}} placeholders. Stray braces are rejected so that
// a malformed placeholder ("{{ memberId }}", "{memberId}") fails loudly instead of being sent to the UI verbatim.
const TEMPLATE_PATTERN = /^(?:[^{}]|\{\{[a-z][a-zA-Z0-9]*\}\})+$/;
const PLACEHOLDER = /\{\{([a-z][a-zA-Z0-9]*)\}\}/g;

export const TemplateStringSchema = z
	.string()
	.max(2000)
	.regex(TEMPLATE_PATTERN)
	.describe(
		'Text that may contain {{paramName}} placeholders (camelCase, no spaces), e.g. "/member/{{memberId}}". Used for routes, labels and expected text. Placeholders are substituted at run time, so an artifact carries the reference, never the concrete value used during discovery.',
	);
export type TemplateString = z.infer<typeof TemplateStringSchema>;

/** The distinct placeholder names used by a template string, in first-use order. */
export function templatePlaceholders(template: string): string[] {
	const names = new Set<string>();
	for (const match of template.matchAll(PLACEHOLDER)) {
		const name = match[1];
		if (name !== undefined) names.add(name);
	}
	return [...names];
}
