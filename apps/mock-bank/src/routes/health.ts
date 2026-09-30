import { sendText } from '../http/respond.js';
import type { Route } from './Route.js';

/** `GET /__health` → 200 `ok`. */
export const healthRoutes: readonly Route[] = [
	{ kind: 'admin', method: 'GET', path: '/__health', handle: ({ res }) => sendText(res, 200, 'ok') },
];
