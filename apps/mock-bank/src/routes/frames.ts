import { readCookie } from '../http/request.js';
import { sendHtml } from '../http/respond.js';
import { aboutScreen } from '../screens/about.js';
import { bannerScreen } from '../screens/banner.js';
import { framesetScreen } from '../screens/frameset.js';
import { navScreen } from '../screens/nav.js';
import { SESSION_COOKIE } from '../session/SessionStore.js';
import type { Route } from './Route.js';

/** The frameset and its static frames. */
export const frameRoutes: readonly Route[] = [
	{
		kind: 'public',
		method: 'GET',
		path: '/',
		handle: ({ req, res, app }) => {
			const signedIn = app.sessions.lookup(readCookie(req, SESSION_COOKIE)).kind === 'active';
			sendHtml(res, 200, framesetScreen(app.tenant, signedIn));
		},
	},
	{
		kind: 'public',
		method: 'GET',
		path: '/banner',
		handle: ({ res, app }) => sendHtml(res, 200, bannerScreen(app.tenant)),
	},
	{ kind: 'public', method: 'GET', path: '/nav', handle: ({ res, app }) => sendHtml(res, 200, navScreen(app.tenant)) },
	{
		kind: 'public',
		method: 'GET',
		path: '/about',
		handle: ({ res, app }) => sendHtml(res, 200, aboutScreen(app.tenant)),
	},
];
