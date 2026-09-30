import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { createAppContext, type AppContext } from './AppContext.js';
import { DEFAULT_CONFIG, type MockBankConfig } from './config.js';
import { FaultSpecError } from './errors/FaultSpecError.js';
import { RequestBodyError } from './errors/RequestBodyError.js';
import { readCookie } from './http/request.js';
import { redirect, sendHtml, sendText } from './http/respond.js';
import { findRoute } from './router.js';
import type { RequestContext, Route } from './routes/Route.js';
import { CLEAR_SESSION_COOKIE } from './routes/signOn.js';
import { appErrorScreen, notFoundScreen, permissionDeniedScreen, serviceUnavailableScreen } from './screens/errors.js';
import { SESSION_COOKIE, type Session } from './session/SessionStore.js';

/** A mock-bank instance: the HTTP server plus its in-memory state. */
export interface MockBankServer {
	readonly http: Server;
	readonly app: AppContext;
	/** Starts listening on `config.host:config.port`; resolves with the base URL (actual port). */
	listen(): Promise<string>;
	close(): Promise<void>;
}

/** Creates the mock-bank server on `node:http`. No runtime dependencies. */
export function createMockBankServer(config: Partial<MockBankConfig> = {}): MockBankServer {
	const full: MockBankConfig = { ...DEFAULT_CONFIG, ...config };
	const app = createAppContext(full);
	const http = createServer((req, res) => {
		handle(app, req, res).catch((error: unknown) => fail(res, error));
	});

	return {
		http,
		app,
		listen: () =>
			new Promise((resolve, reject) => {
				http.once('error', reject);
				http.listen(full.port, full.host, () => {
					http.off('error', reject);
					const { port } = http.address() as AddressInfo;
					resolve(`http://${full.host}:${port}`);
				});
			}),
		close: () =>
			new Promise((resolve, reject) => {
				http.closeAllConnections();
				http.close((error) => (error ? reject(error) : resolve()));
			}),
	};
}

async function handle(app: AppContext, req: IncomingMessage, res: ServerResponse): Promise<void> {
	const url = new URL(req.url ?? '/', 'http://mock-bank.invalid');
	const match = findRoute(req.method ?? 'GET', url.pathname);
	if (match.kind === 'not_found') return sendHtml(res, 404, notFoundScreen());
	if (match.kind === 'method_not_allowed') return sendText(res, 405, 'method not allowed');
	const { route } = match;
	const ctx: RequestContext = { req, res, url, app };
	if (route.kind === 'admin') return route.handle(ctx);

	let session: Session | undefined;
	if (route.kind === 'content') {
		const lookup = app.sessions.lookup(readCookie(req, SESSION_COOKIE));
		if (lookup.kind === 'none') return redirect(res, 302, '/login');
		if (lookup.kind === 'expired') return expiredRedirect(res);
		session = lookup.session;
	}

	if (await applyFaults(app, ctx, session)) return;
	return dispatch(route, ctx, session);
}

function dispatch(route: Route, ctx: RequestContext, session: Session | undefined): Promise<void> | void {
	if (route.kind !== 'content') return route.handle(ctx);
	if (!session) return redirect(ctx.res, 302, '/login');
	return route.handle({ ...ctx, session });
}

/**
 * The request-level faults, in order: session_timeout, slow_load, failed_load(_persistent), app_error,
 * permission_denied. Screen-level faults (member_not_found, validation_error, known_dialog, unknown_dialog,
 * control_missing) are taken by the screen handlers. Returns true when a fault produced the response.
 */
async function applyFaults(
	app: AppContext,
	{ res, url }: RequestContext,
	session: Session | undefined,
): Promise<boolean> {
	const path = url.pathname;
	const { faults } = app;
	if (session && faults.take('session_timeout', path)) {
		app.sessions.expire(session.id);
		expiredRedirect(res);
		return true;
	}
	const slow = faults.take('slow_load', path);
	if (slow) await sleep(slow.delayMs ?? app.config.slowMs);
	if (faults.take('failed_load', path) ?? faults.take('failed_load_persistent', path)) {
		sendHtml(res, 503, serviceUnavailableScreen(), { 'retry-after': '1' });
		return true;
	}
	if (faults.take('app_error', path)) {
		sendHtml(res, 500, appErrorScreen(path));
		return true;
	}
	if (faults.take('permission_denied', path)) {
		sendHtml(res, 200, permissionDeniedScreen());
		return true;
	}
	return false;
}

function expiredRedirect(res: ServerResponse): void {
	redirect(res, 302, '/login?reason=expired', { 'set-cookie': CLEAR_SESSION_COOKIE });
}

function fail(res: ServerResponse, error: unknown): void {
	if (res.headersSent) {
		res.destroy();
		return;
	}
	if (error instanceof RequestBodyError) return sendText(res, error.status, `${error.code}: ${error.message}`);
	if (error instanceof FaultSpecError) return sendText(res, 400, `${error.code}: ${error.message}`);
	process.stderr.write(
		`mock-bank: unhandled error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
	);
	sendText(res, 500, 'internal error');
}
