import { authenticate } from '../data/users.js';
import { readCookie, readForm } from '../http/request.js';
import { redirect, sendHtml } from '../http/respond.js';
import { loginScreen } from '../screens/login.js';
import { SESSION_COOKIE } from '../session/SessionStore.js';
import type { Route } from './Route.js';

/** The cookie that ends a session in the browser. */
export const CLEAR_SESSION_COOKIE = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

/** Sign On (`GET|POST /login`) and Sign Off (`GET /logout`). */
export const signOnRoutes: readonly Route[] = [
	{
		kind: 'public',
		method: 'GET',
		path: '/login',
		handle: ({ res, url }) => {
			const expired = url.searchParams.get('reason') === 'expired';
			sendHtml(res, 200, loginScreen(expired ? { message: 'sessionExpired' } : {}));
		},
	},
	{
		kind: 'public',
		method: 'POST',
		path: '/login',
		handle: async ({ req, res, app }) => {
			const form = await readForm(req);
			const userId = form.get('txtUser') ?? '';
			const user = authenticate(userId, form.get('txtPwd') ?? '');
			if (!user) {
				sendHtml(res, 200, loginScreen({ message: 'invalidCredentials', userId }));
				return;
			}
			const session = app.sessions.create(user);
			redirect(res, 303, '/member/search', {
				'set-cookie': `${SESSION_COOKIE}=${session.id}; Path=/; HttpOnly; SameSite=Lax`,
			});
		},
	},
	{
		kind: 'public',
		method: 'GET',
		path: '/logout',
		handle: ({ req, res, app }) => {
			const id = readCookie(req, SESSION_COOKIE);
			if (id !== undefined) app.sessions.destroy(id);
			redirect(res, 302, '/login', { 'set-cookie': CLEAR_SESSION_COOKIE });
		},
	},
];
