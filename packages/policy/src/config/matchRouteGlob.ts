import { PolicyConfigError } from '../errors/PolicyConfigError.js';

/** A compiled route glob: true when the path (no query, no hash) matches. */
export type RouteMatcher = (path: string) => boolean;

const escape = (text: string) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/**
 * Compiles a route glob into a matcher. `*` matches within one segment, `**` across any number of segments
 * (including none: `/member/**` matches `/member`). Everything else matches literally.
 */
export function compileRouteGlob(glob: string): RouteMatcher {
	if (!glob.startsWith('/') || /\s/.test(glob)) {
		throw new PolicyConfigError('invalid_route_glob', `route glob "${glob}" must start with "/" and have no spaces`);
	}
	let source = '';
	let index = 0;
	while (index < glob.length) {
		if (glob.startsWith('/**', index) && (index + 3 === glob.length || glob[index + 3] === '/')) {
			source += '(?:/.*)?';
			index += 3;
		} else if (glob.startsWith('**', index)) {
			source += '.*';
			index += 2;
		} else if (glob[index] === '*') {
			source += '[^/]*';
			index += 1;
		} else {
			source += escape(glob[index] ?? '');
			index += 1;
		}
	}
	const regex = new RegExp(`^${source}$`);
	return (path) => regex.test(path);
}
