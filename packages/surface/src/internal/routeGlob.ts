const escape = (text: string) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/** Compiles a route glob: `*` matches within one segment, `**` across segments (`/a/**` also matches `/a`). */
export function routeGlobToRegExp(glob: string): RegExp {
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
	return new RegExp(`^${source}$`);
}

/**
 * Whether a route (a URL path, optionally with its query) matches a glob. Unlike the policy matcher, a glob
 * may start with `**` (checkpoints and frame hops use "**\/member/detail*").
 */
export function matchesRouteGlob(glob: string, route: string): boolean {
	return routeGlobToRegExp(glob).test(route);
}
