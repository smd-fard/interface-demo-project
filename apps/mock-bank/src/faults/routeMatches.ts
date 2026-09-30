/**
 * Matches a request path against a route filter. A filter containing `*` is a glob (`*` matches any run of
 * characters, including `/`) anchored at both ends; a filter without `*` is a path prefix.
 */
export function routeMatches(filter: string, path: string): boolean {
	if (!filter.includes('*')) return path.startsWith(filter);
	const pattern = filter
		.split('*')
		.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
		.join('.*');
	return new RegExp(`^${pattern}$`).test(path);
}
