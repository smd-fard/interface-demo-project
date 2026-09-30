import { InterventionIdSchema } from '@idp/artifact-schema';

/** A console page to return to after an action: `/` or `/interventions/<id>`; anything else becomes `/`. */
export function safeReturnPath(value: string | null): string {
	if (value === null || value === '/') return '/';
	const match = /^\/interventions\/([^/?#]+)$/.exec(value);
	return match !== null && InterventionIdSchema.safeParse(match[1]).success ? value : '/';
}
