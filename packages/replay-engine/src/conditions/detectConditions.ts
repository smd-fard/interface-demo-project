import type { ConditionSignature, FrameHop, FrameScope } from '@idp/artifact-schema';
import { compileRouteGlob } from '@idp/policy';
import { normalizeText, type FrameInfo, type Observation } from '@idp/surface';
import type { ResolvedRule } from './resolveRules.js';

/** A rule whose signature matched an observation. */
export interface ConditionMatch {
	readonly code: string;
	readonly rule: ResolvedRule;
	/**
	 * The signature's own text that matched (e.g. "No records match your search criteria", "HTTP 503") — never
	 * observed screen text, so it carries no member data. Still redacted before any sink.
	 */
	readonly matchedText: string;
}

type Leaf = Exclude<ConditionSignature, { kind: 'any_of' }>;

const samePath = (a: readonly string[], b: readonly string[]) =>
	a.length === b.length && a.every((hop, index) => hop === b[index]);

/** A route glob; one written relative ("**\/login*") is anchored at the root, as policy globs are. */
function routeMatcher(glob: string): (route: string) => boolean {
	return compileRouteGlob(glob.startsWith('/') ? glob : `/${glob}`);
}

/** The frame's route: its path, and its path with the query. Empty for a non-http document (about:blank). */
function routesOf(url: string): string[] {
	if (!/^https?:/i.test(url)) return [];
	const parsed = new URL(url);
	return [parsed.pathname, `${parsed.pathname}${parsed.search}`];
}

function hopMatches(hop: FrameHop, frame: FrameInfo): boolean {
	switch (hop.kind) {
		case 'by_name':
			return frame.name === hop.name;
		case 'by_url_path': {
			const matches = routeMatcher(hop.glob);
			return routesOf(frame.url).some((route) => matches(route));
		}
		case 'by_title':
			return normalizeText(frame.title).includes(normalizeText(hop.title));
	}
}

/** The frames a scope selects: each hop must match the ancestor at its depth. `[]` is the top document. */
function framesIn(observation: Observation, scope: FrameScope): FrameInfo[] {
	return observation.frames.filter((frame) => {
		if (frame.path.length !== scope.length) return false;
		return scope.every((hop, depth) => {
			const ancestor = observation.frames.find((candidate) => samePath(candidate.path, frame.path.slice(0, depth + 1)));
			return ancestor !== undefined && hopMatches(hop, ancestor);
		});
	});
}

function matchLeaf(signature: Leaf, observation: Observation): string | null {
	switch (signature.kind) {
		case 'text_present': {
			const frames = signature.frame === undefined ? observation.frames : framesIn(observation, signature.frame);
			const text = normalizeText(signature.text);
			return frames.some((frame) => normalizeText(frame.text).includes(text)) ? signature.text : null;
		}
		case 'title_matches': {
			const titles =
				signature.frame === undefined
					? [observation.title, ...observation.frames.map((frame) => frame.title)]
					: framesIn(observation, signature.frame).map((frame) => frame.title);
			const title = normalizeText(signature.title);
			return titles.some((candidate) => normalizeText(candidate).includes(title)) ? signature.title : null;
		}
		case 'route_matches': {
			const matches = routeMatcher(signature.route);
			const urls = [observation.url, ...observation.frames.map((frame) => frame.url)];
			return urls.some((url) => routesOf(url).some((route) => matches(route))) ? signature.route : null;
		}
		case 'dialog_text': {
			const dialog = observation.pendingDialog;
			if (dialog === null) return null;
			return normalizeText(dialog.message).includes(normalizeText(signature.text)) ? signature.text : null;
		}
		case 'http_status': {
			const status = observation.lastNavigation?.status ?? null;
			return status !== null && status >= signature.min && status <= signature.max ? `HTTP ${status}` : null;
		}
	}
}

/**
 * Evaluates one signature against an observation: the matched signature text, or `null`. Text matching is a
 * normalized (whitespace-collapsed), case-sensitive substring — fixed wording, no regex (the schema's contract).
 */
export function matchSignature(signature: ConditionSignature, observation: Observation): string | null {
	if (signature.kind !== 'any_of') return matchLeaf(signature, observation);
	for (const leaf of signature.signatures) {
		const matched = matchLeaf(leaf, observation);
		if (matched !== null) return matched;
	}
	return null;
}

/**
 * The runtime-condition detector (define-runtime-condition touch point 2): the first rule, in resolution order,
 * whose signature matches the observation, or `null`. Pure and deterministic: no model, no I/O (invariant 1).
 */
export function detectConditions(rules: readonly ResolvedRule[], observation: Observation): ConditionMatch | null {
	for (const rule of rules) {
		const matchedText = matchSignature(rule.signature, observation);
		if (matchedText !== null) return { code: rule.code, rule, matchedText };
	}
	return null;
}
