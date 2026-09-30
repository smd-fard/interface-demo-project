import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../AppContext.js';
import type { Session } from '../session/SessionStore.js';

/** The HTTP methods the route table uses. */
export type HttpMethod = 'GET' | 'POST' | 'DELETE';

/** What every handler receives. */
export interface RequestContext {
	readonly req: IncomingMessage;
	readonly res: ServerResponse;
	readonly url: URL;
	readonly app: AppContext;
}

/** What a signed-in content handler receives: the active session is guaranteed. */
export interface ContentContext extends RequestContext {
	readonly session: Session;
}

/**
 * One entry of the route table.
 * - `admin`: test/ops endpoints (`/__admin/**`, `/__health`). Never faulted, never session-checked.
 * - `public`: frames and Sign On. No session needed; faulted only by a fault with an explicit matching route.
 * - `content`: signed-in screens. Session required; faults apply on their default routes.
 */
export type Route =
	| {
			readonly kind: 'admin' | 'public';
			readonly method: HttpMethod;
			readonly path: string;
			readonly handle: (ctx: RequestContext) => Promise<void> | void;
	  }
	| {
			readonly kind: 'content';
			readonly method: HttpMethod;
			readonly path: string;
			readonly handle: (ctx: ContentContext) => Promise<void> | void;
	  };
