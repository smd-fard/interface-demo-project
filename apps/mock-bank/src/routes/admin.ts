import { parseFaultSpec } from '../faults/parseFaultSpec.js';
import { readJson } from '../http/request.js';
import { sendEmpty, sendJson } from '../http/respond.js';
import type { Route } from './Route.js';

/**
 * The admin API used by tests and demos (never by the system under test):
 * `GET|POST|DELETE /__admin/faults` and `POST /__admin/reset`.
 */
export const adminRoutes: readonly Route[] = [
	{
		kind: 'admin',
		method: 'GET',
		path: '/__admin/faults',
		handle: ({ res, app }) => sendJson(res, 200, app.faults.list()),
	},
	{
		kind: 'admin',
		method: 'POST',
		path: '/__admin/faults',
		handle: async ({ req, res, app }) => {
			app.faults.arm(parseFaultSpec(await readJson(req)));
			sendJson(res, 201, app.faults.list());
		},
	},
	{
		kind: 'admin',
		method: 'DELETE',
		path: '/__admin/faults',
		handle: ({ res, app }) => {
			app.faults.clear();
			sendEmpty(res);
		},
	},
	{
		kind: 'admin',
		method: 'POST',
		path: '/__admin/reset',
		handle: ({ res, app }) => {
			app.reset();
			sendEmpty(res);
		},
	},
];
