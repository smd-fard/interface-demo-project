import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { EvidenceIdSchema, InterventionIdSchema } from '@idp/artifact-schema';
import { ControlApiError } from '@idp/session';
import { OperatorHttpError } from './errors/OperatorHttpError.js';
import { OperatorServerStartError } from './errors/OperatorServerStartError.js';
import { readForm } from './http/readForm.js';
import { safeReturnPath } from './http/safeReturnPath.js';
import { BASE_HEADERS, DATA_CSP, pageCsp } from './http/securityHeaders.js';
import type { OperatorControl } from './OperatorControl.js';
import { stateVersion } from './stateVersion.js';
import { errorPage } from './views/errorPage.js';
import { interventionDetail } from './views/interventionDetail.js';
import { interventionList } from './views/interventionList.js';
import { layout } from './views/layout.js';

/** Options of `OperatorServer.start`. */
export interface OperatorServerOptions {
	/** The session's control API, usually a `ControlClient` (which holds the token). */
	readonly control: OperatorControl;
	/** 0 = an ephemeral port (default). The console always binds to 127.0.0.1. */
	readonly port?: number;
	/** Receives unexpected errors (answered 500 without detail). When omitted they are kept in `errors`. */
	readonly onError?: (error: unknown) => void;
}

const HOST = '127.0.0.1';
const HANDLE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const EVIDENCE_TYPES: ReadonlySet<string> = new Set(['image/png', 'application/json; charset=utf-8']);

type Handler = (request: IncomingMessage, response: ServerResponse, param: string) => Promise<void>;

interface Route {
	readonly pattern: RegExp;
	readonly methods: Readonly<Record<string, Handler>>;
}

type InterventionOperation = 'claim' | 'approve' | 'reject';

function interventionId(value: string): string {
	if (!InterventionIdSchema.safeParse(value).success) {
		throw new OperatorHttpError(404, 'NOT_FOUND', 'no such intervention request');
	}
	return value;
}

/** The error code to show after a refused action: the session's code, or a generic one. */
function refusalCode(error: ControlApiError): string {
	return ERROR_CODE.test(error.apiCode) ? error.apiCode : 'CONTROL_API_ERROR';
}

/** Maps a control API failure on a read to the console's answer. */
function readFailure(error: ControlApiError, notFound: string): OperatorHttpError {
	if (error.status === 404) return new OperatorHttpError(404, 'NOT_FOUND', notFound, { cause: error });
	if (error.status === 403) {
		return new OperatorHttpError(403, refusalCode(error), 'the session does not share this evidence', {
			cause: error,
		});
	}
	if (error.status === 0) {
		return new OperatorHttpError(502, 'UNREACHABLE', 'The session control API is unreachable.', { cause: error });
	}
	return new OperatorHttpError(502, 'BAD_GATEWAY', `The session control API answered ${refusalCode(error)}.`, {
		cause: error,
	});
}

/**
 * The operator console (R6.4): a deliberately mocked, server-rendered web page on `node:http`, bound to
 * 127.0.0.1. It proxies to the session's control API through `ControlClient`, so the browser never sees the
 * session token. Everything it shows is already redacted by the session; every value is HTML-escaped.
 *
 * Routes: `GET /` (list + lease badge), `GET /interventions/:id` (detail), `GET /evidence/:refId` (proxied
 * masked screenshot / redacted snapshot), `POST /interventions/:id/{claim,approve,reject}`, `POST /resume`,
 * `POST /abort` (form posts → 303 back), `GET /api/state` (JSON for polling).
 *
 * Security: a foreign `Host` header → 421 (DNS rebinding); every POST needs a same-origin `Origin` /
 * `Sec-Fetch-Site` (when sent) and the per-process form token embedded in the pages (→ 403 `CSRF_REJECTED`);
 * pages carry a CSP that allows only the nonce'd inline script and style.
 */
export class OperatorServer {
	/** Unexpected errors, when no `onError` is given. */
	readonly errors: unknown[] = [];
	private readonly routes: readonly Route[];
	private readonly formToken = randomBytes(32).toString('hex');

	private constructor(
		private readonly server: Server,
		private readonly options: OperatorServerOptions,
	) {
		const operate = (operation: InterventionOperation): Handler => {
			return async (request, response, id) => this.operateOnRequest(request, response, id, operation);
		};
		this.routes = [
			{ pattern: /^\/$/, methods: { GET: async (q, r) => this.listPage(q, r) } },
			{ pattern: /^\/api\/state$/, methods: { GET: async (_q, r) => this.state(r) } },
			{ pattern: /^\/interventions\/([^/]+)$/, methods: { GET: async (q, r, id) => this.detailPage(q, r, id) } },
			{ pattern: /^\/interventions\/([^/]+)\/claim$/, methods: { POST: operate('claim') } },
			{ pattern: /^\/interventions\/([^/]+)\/approve$/, methods: { POST: operate('approve') } },
			{ pattern: /^\/interventions\/([^/]+)\/reject$/, methods: { POST: operate('reject') } },
			{ pattern: /^\/resume$/, methods: { POST: async (q, r) => this.operateOnLease(q, r, 'resume') } },
			{ pattern: /^\/abort$/, methods: { POST: async (q, r) => this.operateOnLease(q, r, 'abort') } },
			{ pattern: /^\/evidence\/([^/]+)$/, methods: { GET: async (_q, r, refId) => this.evidence(r, refId) } },
		];
	}

	/** Starts the console on 127.0.0.1. Throws `OperatorServerStartError` (e.g. the port is taken). */
	static async start(options: OperatorServerOptions): Promise<OperatorServer> {
		const server = createServer();
		const operatorServer = new OperatorServer(server, options);
		server.on('request', (request, response) => {
			void operatorServer.handle(request, response);
		});
		await new Promise<void>((resolve, reject) => {
			const onError = (cause: Error) => reject(new OperatorServerStartError(`cannot listen on ${HOST}`, { cause }));
			server.once('error', onError);
			server.listen(options.port ?? 0, HOST, () => {
				server.off('error', onError);
				resolve();
			});
		});
		server.on('error', (error) => operatorServer.report(error));
		return operatorServer;
	}

	address(): { readonly address: string; readonly port: number } {
		const info = this.server.address() as AddressInfo;
		return { address: info.address, port: info.port };
	}

	/** E.g. `http://127.0.0.1:4030`. */
	get url(): string {
		return `http://${HOST}:${this.address().port}`;
	}

	/** Stops accepting connections and closes open ones. Idempotent. */
	async close(): Promise<void> {
		if (!this.server.listening) return;
		await new Promise<void>((resolve, reject) => {
			this.server.close((error) => (error === undefined ? resolve() : reject(error)));
			this.server.closeAllConnections();
		});
	}

	private report(error: unknown): void {
		if (this.options.onError !== undefined) this.options.onError(error);
		else this.errors.push(error);
	}

	private allowedHosts(): readonly string[] {
		const { port } = this.address();
		return [`127.0.0.1:${port}`, `localhost:${port}`];
	}

	private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
		try {
			if (!this.allowedHosts().includes(request.headers.host ?? '')) {
				throw new OperatorHttpError(421, 'HOST_REJECTED', 'this console answers on 127.0.0.1 only');
			}
			const pathname = new URL(request.url ?? '/', this.url).pathname;
			for (const route of this.routes) {
				const match = route.pattern.exec(pathname);
				if (match === null) continue;
				const handler = route.methods[request.method ?? ''];
				if (handler === undefined) throw new OperatorHttpError(405, 'METHOD_NOT_ALLOWED', 'method not allowed here');
				await handler(request, response, match[1] ?? '');
				return;
			}
			throw new OperatorHttpError(404, 'NOT_FOUND', 'no such page');
		} catch (error) {
			this.fail(response, error);
		}
	}

	private fail(response: ServerResponse, error: unknown): void {
		if (response.headersSent) {
			this.report(error);
			response.destroy();
			return;
		}
		if (error instanceof OperatorHttpError) {
			this.sendError(response, error.status, error.code, error.message);
			return;
		}
		if (error instanceof ControlApiError) {
			const failure = readFailure(error, 'not found');
			this.sendError(response, failure.status, failure.code, failure.message);
			return;
		}
		this.report(error);
		this.sendError(response, 500, 'INTERNAL', 'internal error');
	}

	private sendError(response: ServerResponse, status: number, code: string, message: string): void {
		const html = errorPage(status, code, message);
		response.writeHead(status, {
			...BASE_HEADERS,
			'content-type': 'text/html; charset=utf-8',
			'content-length': Buffer.byteLength(html),
			'content-security-policy': pageCsp(randomBytes(16).toString('base64')),
			...(status === 413 || status === 415 ? { connection: 'close' } : {}),
		});
		response.end(html);
	}

	private sendPage(response: ServerResponse, nonce: string, html: string): void {
		response.writeHead(200, {
			...BASE_HEADERS,
			'content-type': 'text/html; charset=utf-8',
			'content-length': Buffer.byteLength(html),
			'content-security-policy': pageCsp(nonce),
		});
		response.end(html);
	}

	private redirect(response: ServerResponse, location: string): void {
		response.writeHead(303, { ...BASE_HEADERS, location, 'content-length': 0 });
		response.end();
	}

	/** The flash message from `?error=CODE`, when CODE is a well-formed error code. */
	private flash(request: IncomingMessage): string | undefined {
		const code = new URL(request.url ?? '/', this.url).searchParams.get('error');
		if (code === null || !ERROR_CODE.test(code)) return undefined;
		return code === 'INVALID_OPERATOR'
			? 'Refused: INVALID_OPERATOR (the operator handle must look like "ops-1").'
			: `Refused by the session: ${code}.`;
	}

	private async read<T>(call: () => Promise<T>, notFound = 'not found'): Promise<T> {
		try {
			return await call();
		} catch (error) {
			if (error instanceof ControlApiError) throw readFailure(error, notFound);
			throw error;
		}
	}

	private async listPage(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const [lease, requests] = await this.read(() =>
			Promise.all([this.options.control.lease(), this.options.control.interventions()]),
		);
		const nonce = randomBytes(16).toString('base64');
		const flash = this.flash(request);
		this.sendPage(
			response,
			nonce,
			layout({
				title: 'Interventions',
				nonce,
				lease,
				stateVersion: stateVersion(lease, requests),
				body: interventionList({ requests, lease, formToken: this.formToken }),
				...(flash === undefined ? {} : { flash }),
			}),
		);
	}

	private async detailPage(request: IncomingMessage, response: ServerResponse, rawId: string): Promise<void> {
		const id = interventionId(rawId);
		const [lease, requests, intervention] = await this.read(
			() =>
				Promise.all([
					this.options.control.lease(),
					this.options.control.interventions(),
					this.options.control.intervention(id),
				]),
			'no such intervention request',
		);
		const nonce = randomBytes(16).toString('base64');
		const flash = this.flash(request);
		this.sendPage(
			response,
			nonce,
			layout({
				title: `Intervention ${intervention.id}`,
				nonce,
				lease,
				stateVersion: stateVersion(lease, requests),
				body: interventionDetail({ request: intervention, lease, formToken: this.formToken }),
				...(flash === undefined ? {} : { flash }),
			}),
		);
	}

	private async state(response: ServerResponse): Promise<void> {
		const [lease, requests] = await this.read(() =>
			Promise.all([this.options.control.lease(), this.options.control.interventions()]),
		);
		const json = JSON.stringify({
			lease: { state: lease.state, holder: lease.holder },
			interventions: requests.map((request) => ({
				id: request.id,
				kind: request.kind,
				status: request.status,
				reasonCode: request.reason.code,
				createdAt: request.createdAt,
			})),
			version: stateVersion(lease, requests),
		});
		response.writeHead(200, {
			...BASE_HEADERS,
			'content-type': 'application/json; charset=utf-8',
			'content-length': Buffer.byteLength(json),
			'content-security-policy': DATA_CSP,
		});
		response.end(json);
	}

	private async evidence(response: ServerResponse, refId: string): Promise<void> {
		if (!EvidenceIdSchema.safeParse(refId).success) throw new OperatorHttpError(404, 'NOT_FOUND', 'no such evidence');
		const served = await this.read(() => this.options.control.evidence(refId), 'no such evidence');
		if (!EVIDENCE_TYPES.has(served.contentType)) {
			throw new OperatorHttpError(502, 'BAD_GATEWAY', 'the session served evidence of an unexpected type');
		}
		response.writeHead(200, {
			...BASE_HEADERS,
			'content-type': served.contentType,
			'content-length': served.bytes.length,
			'content-security-policy': DATA_CSP,
		});
		response.end(served.bytes);
	}

	/** CSRF checks and the form: same-origin (when the browser says), url-encoded, carrying the form token. */
	private async readActionForm(request: IncomingMessage): Promise<URLSearchParams> {
		const origin = request.headers.origin;
		const origins = this.allowedHosts().map((host) => `http://${host}`);
		if (origin !== undefined && !origins.includes(origin)) {
			throw new OperatorHttpError(403, 'CSRF_REJECTED', 'cross-origin form posts are refused');
		}
		const site = request.headers['sec-fetch-site'];
		if (site !== undefined && site !== 'same-origin' && site !== 'none') {
			throw new OperatorHttpError(403, 'CSRF_REJECTED', 'cross-site form posts are refused');
		}
		const form = await readForm(request);
		const presented = Buffer.from(form.get('formToken') ?? '');
		const expected = Buffer.from(this.formToken);
		if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
			throw new OperatorHttpError(403, 'CSRF_REJECTED', 'the form token is missing or wrong; reload the console');
		}
		return form;
	}

	/** Runs an action and redirects to `back`, with `?error=CODE` when the session refused it. */
	private async act(response: ServerResponse, back: string, action: () => Promise<unknown>): Promise<void> {
		try {
			await action();
		} catch (error) {
			if (!(error instanceof ControlApiError)) throw error;
			this.redirect(response, `${back}?error=${refusalCode(error)}`);
			return;
		}
		this.redirect(response, back);
	}

	private async operateOnRequest(
		request: IncomingMessage,
		response: ServerResponse,
		rawId: string,
		operation: InterventionOperation,
	): Promise<void> {
		const id = interventionId(rawId);
		const form = await this.readActionForm(request);
		const back = `/interventions/${id}`;
		const operator = form.get('operator') ?? '';
		if (!HANDLE.test(operator)) {
			this.redirect(response, `${back}?error=INVALID_OPERATOR`);
			return;
		}
		const { control } = this.options;
		await this.act(response, back, () =>
			operation === 'claim'
				? control.claim(id, operator)
				: operation === 'approve'
					? control.approve(id, operator)
					: control.reject(id, operator),
		);
	}

	private async operateOnLease(
		request: IncomingMessage,
		response: ServerResponse,
		operation: 'resume' | 'abort',
	): Promise<void> {
		const form = await this.readActionForm(request);
		const back = safeReturnPath(form.get('return'));
		const operator = form.get('operator') ?? '';
		if (!HANDLE.test(operator)) {
			this.redirect(response, `${back}?error=INVALID_OPERATOR`);
			return;
		}
		const { control } = this.options;
		await this.act(response, back, () => (operation === 'resume' ? control.resume(operator) : control.abort(operator)));
	}
}
