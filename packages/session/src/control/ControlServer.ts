import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OperatorActorSchema, type EvidenceRef, type OperatorActor } from '@idp/artifact-schema';
import { systemRandom, type Random } from '@idp/evidence';
import { ControlServerStartError } from '../errors/ControlServerStartError.js';
import type { ControlTarget } from './ControlTarget.js';

/** Configures `ControlServer.start`: the session it drives, the port, the token randomness and an error sink. */
export interface ControlServerOptions {
	readonly target: ControlTarget;
	/** 0 (default) = an ephemeral port. The server always binds to 127.0.0.1. */
	readonly port?: number;
	/** Randomness for the bearer token (64 hex characters). */
	readonly random?: Random;
	/** Receives unexpected errors (answered 500 without detail). When omitted they are kept in `errors`. */
	readonly onError?: (error: unknown) => void;
}

const HOST = '127.0.0.1';
const TOKEN_HEX = 64;
const MAX_BODY_BYTES = 16 * 1024;
const HANDLE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** HTTP status per session error code. */
const STATUS_BY_CODE: Readonly<Record<string, number>> = {
	ILLEGAL_LEASE_TRANSITION: 409,
	INTERVENTION_CONFLICT: 409,
	APPROVAL_GRANT_INVALID: 409,
	INTERVENTION_NOT_FOUND: 404,
	SESSION_VALIDATION: 400,
};

class HttpError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'HttpError';
	}
}

type Handler = (request: IncomingMessage, response: ServerResponse, params: readonly string[]) => Promise<void>;

interface Route {
	readonly pattern: RegExp;
	readonly methods: Readonly<Record<string, Handler>>;
}

function isShareable(ref: EvidenceRef): boolean {
	if (ref.localOnly) return false;
	if (ref.kind === 'screenshot' || ref.kind === 'a11y_snapshot') return true;
	return ref.kind === 'json' && ref.path.startsWith('interventions/');
}

function send(response: ServerResponse, status: number, body: unknown): void {
	const json = JSON.stringify(body);
	response.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'content-length': Buffer.byteLength(json),
		'cache-control': 'no-store',
		'x-content-type-options': 'nosniff',
	});
	response.end(json);
}

function sendError(response: ServerResponse, status: number, code: string, message: string): void {
	send(response, status, { error: { code, message } });
}

async function readBody(request: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = chunk as Buffer;
		size += buffer.length;
		if (size > MAX_BODY_BYTES) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `body exceeds ${MAX_BODY_BYTES} bytes`);
		chunks.push(buffer);
	}
	return Buffer.concat(chunks).toString('utf8');
}

/** Validates `{ "operator": "<handle>" }` (nothing else) and returns `operator:<handle>`. */
async function readOperator(request: IncomingMessage): Promise<OperatorActor> {
	const text = await readBody(request);
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		throw new HttpError(400, 'BAD_REQUEST', 'the body must be JSON: { "operator": "<handle>" }');
	}
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		throw new HttpError(400, 'BAD_REQUEST', 'the body must be an object: { "operator": "<handle>" }');
	}
	const keys = Object.keys(body);
	const handle = (body as { operator?: unknown }).operator;
	if (keys.length !== 1 || typeof handle !== 'string' || !HANDLE.test(handle)) {
		throw new HttpError(
			400,
			'BAD_REQUEST',
			'operator: a lowercase handle such as "ops-1" is required (no other field)',
		);
	}
	const actor = OperatorActorSchema.safeParse(`operator:${handle}`);
	if (!actor.success) throw new HttpError(400, 'BAD_REQUEST', 'operator: not a valid handle');
	return actor.data;
}

/**
 * The session's localhost control API (ADR-0006), for the separate operator console. `node:http`, bound to
 * 127.0.0.1 only, on a configurable port (0 = ephemeral). Every request needs the bearer token generated for
 * this session (64 random hex characters, compared in constant time); without it → 401.
 *
 * Routes (JSON): `GET /lease`, `GET /interventions`, `GET /interventions/:id`, `GET /evidence/:refId`
 * (masked screenshots, redacted snapshots and intervention documents only — never local-only files such as
 * traces, never prompts), `POST /interventions/:id/claim|approve|reject`, `POST /resume`, `POST /abort`. Each
 * POST body is exactly `{ "operator": "<handle>" }`. Errors are `{ error: { code, message } }`: 400 invalid
 * body, 401 token, 403 evidence not shareable, 404 unknown route/request/evidence, 405 method, 409 illegal
 * lease transition or request conflict, 413 body too large, 500 anything unexpected (no detail; the error goes
 * to `onError`). Everything served is already redacted by the session.
 */
export class ControlServer {
	/** Unexpected errors, when no `onError` is given. */
	readonly errors: unknown[] = [];
	private readonly routes: readonly Route[];

	private constructor(
		private readonly server: Server,
		private readonly options: ControlServerOptions,
		/** The per-session bearer token. Give it only to the operator process; never log it. */
		readonly token: string,
	) {
		const { target } = options;
		const ok = (response: ServerResponse, body: unknown) => send(response, 200, body);
		this.routes = [
			{ pattern: /^\/lease$/, methods: { GET: async (_q, r) => ok(r, target.lease()) } },
			{ pattern: /^\/interventions$/, methods: { GET: async (_q, r) => ok(r, target.interventions()) } },
			{
				pattern: /^\/interventions\/([^/]+)$/,
				methods: {
					GET: async (_q, r, [id = '']) => {
						const request = target.intervention(id);
						if (request === undefined) throw new HttpError(404, 'NOT_FOUND', 'no such intervention request');
						ok(r, request);
					},
				},
			},
			{
				pattern: /^\/interventions\/([^/]+)\/(claim|approve|reject)$/,
				methods: {
					POST: async (q, r, [id = '', operation = '']) => {
						const operator = await readOperator(q);
						if (operation === 'claim') ok(r, await target.claim(id, operator));
						else if (operation === 'approve') ok(r, await target.approve(id, operator));
						else ok(r, await target.reject(id, operator));
					},
				},
			},
			{ pattern: /^\/resume$/, methods: { POST: async (q, r) => ok(r, await target.resume(await readOperator(q))) } },
			{ pattern: /^\/abort$/, methods: { POST: async (q, r) => ok(r, await target.abort(await readOperator(q))) } },
			{
				pattern: /^\/evidence\/([^/]+)$/,
				methods: { GET: async (_q, r, [refId = '']) => this.serveEvidence(r, refId) },
			},
		];
	}

	/** Starts the server on 127.0.0.1. Throws `ControlServerStartError` (e.g. the port is taken). */
	static async start(options: ControlServerOptions): Promise<ControlServer> {
		const token = (options.random ?? systemRandom).hex(TOKEN_HEX);
		if (!/^[0-9a-f]{32,}$/.test(token)) throw new ControlServerStartError('the token source must yield lowercase hex');
		const server = createServer();
		const control = new ControlServer(server, options, token);
		server.on('request', (request, response) => {
			void control.handle(request, response);
		});
		await new Promise<void>((resolve, reject) => {
			const onError = (cause: Error) => reject(new ControlServerStartError(`cannot listen on ${HOST}`, { cause }));
			server.once('error', onError);
			server.listen(options.port ?? 0, HOST, () => {
				server.off('error', onError);
				resolve();
			});
		});
		server.on('error', (error) => control.report(error));
		return control;
	}

	/** The bound address (always 127.0.0.1) and port. */
	address(): { readonly address: string; readonly port: number } {
		const info = this.server.address() as AddressInfo;
		return { address: info.address, port: info.port };
	}

	/** E.g. `http://127.0.0.1:53211`. */
	get url(): string {
		return `http://${HOST}:${this.address().port}`;
	}

	/** Stops accepting connections and closes idle ones. Idempotent. */
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

	private authorized(request: IncomingMessage): boolean {
		const header = request.headers.authorization;
		if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
		const presented = Buffer.from(header.slice('Bearer '.length).trim());
		const expected = Buffer.from(this.token);
		return presented.length === expected.length && timingSafeEqual(presented, expected);
	}

	private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
		try {
			if (!this.authorized(request)) {
				// Drain nothing: the body of an unauthenticated request is never read.
				sendError(response, 401, 'UNAUTHORIZED', 'a valid bearer token is required');
				return;
			}
			const pathname = new URL(request.url ?? '/', `http://${HOST}`).pathname;
			for (const route of this.routes) {
				const match = route.pattern.exec(pathname);
				if (match === null) continue;
				const handler = route.methods[request.method ?? ''];
				if (handler === undefined) throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'method not allowed on this route');
				await handler(
					request,
					response,
					match.slice(1).map((part) => decodeURIComponent(part)),
				);
				return;
			}
			throw new HttpError(404, 'NOT_FOUND', 'no such route');
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
		if (error instanceof HttpError) {
			sendError(response, error.status, error.code, error.message);
			return;
		}
		const code = error instanceof Error ? (error as { code?: unknown }).code : undefined;
		const status = typeof code === 'string' ? STATUS_BY_CODE[code] : undefined;
		if (status !== undefined && typeof code === 'string' && error instanceof Error) {
			// Session errors name states, operations, ids and fields — never values.
			sendError(response, status, code, error.message);
			return;
		}
		this.report(error);
		sendError(response, 500, 'INTERNAL', 'internal error');
	}

	private async serveEvidence(response: ServerResponse, refId: string): Promise<void> {
		const stored = this.options.target.evidence(refId);
		if (stored === undefined) throw new HttpError(404, 'NOT_FOUND', 'no such evidence');
		if (!isShareable(stored.ref)) {
			throw new HttpError(403, 'EVIDENCE_NOT_SHAREABLE', 'only masked screenshots and redacted documents are served');
		}
		const bytes = await readFile(stored.absolutePath);
		response.writeHead(200, {
			'content-type': stored.ref.kind === 'screenshot' ? 'image/png' : 'application/json; charset=utf-8',
			'content-length': bytes.length,
			'cache-control': 'no-store',
			'x-content-type-options': 'nosniff',
		});
		response.end(bytes);
	}
}
