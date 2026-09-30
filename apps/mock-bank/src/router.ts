import { adminRoutes } from './routes/admin.js';
import { frameRoutes } from './routes/frames.js';
import { healthRoutes } from './routes/health.js';
import { memberRoutes } from './routes/member.js';
import type { Route } from './routes/Route.js';
import { signOnRoutes } from './routes/signOn.js';
import { subAccountRoutes } from './routes/subAccount.js';

/** The whole app as one table: method + exact path → route. */
export const ROUTES: readonly Route[] = [
	...healthRoutes,
	...adminRoutes,
	...frameRoutes,
	...signOnRoutes,
	...memberRoutes,
	...subAccountRoutes,
];

/** The result of `findRoute`: the route, or why there is none (404 vs 405). */
export type RouteMatch =
	| { readonly kind: 'found'; readonly route: Route }
	| { readonly kind: 'method_not_allowed' }
	| { readonly kind: 'not_found' };

/** Looks a request up in the table. */
export function findRoute(method: string, path: string, routes: readonly Route[] = ROUTES): RouteMatch {
	const onPath = routes.filter((route) => route.path === path);
	const route = onPath.find((candidate) => candidate.method === method);
	if (route) return { kind: 'found', route };
	return onPath.length > 0 ? { kind: 'method_not_allowed' } : { kind: 'not_found' };
}
