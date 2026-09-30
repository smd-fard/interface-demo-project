import {
	InterventionRequestSchema,
	LeaseStateSchema,
	LeaseTransitionSchema,
	type InterventionRequest,
	type LeaseTransition,
} from '@idp/artifact-schema';
import { ControlApiError } from '../errors/ControlApiError.js';
import { SessionValidationError } from '../errors/SessionValidationError.js';
import type { LeaseHolder } from '../lease/ControlLease.js';
import type { LeaseView } from './LeaseView.js';

/** Where the control API is and the bearer token for it. */
export interface ControlClientOptions {
	/** The control server's base URL, e.g. `http://127.0.0.1:53211`. */
	readonly url: string;
	/** The session's bearer token. */
	readonly token: string;
	/** Injected fetch (default: the global one). */
	readonly fetch?: typeof fetch;
}

/** An evidence file as served: masked PNG bytes or a redacted JSON document. */
export interface ServedEvidence {
	readonly contentType: string;
	readonly bytes: Uint8Array;
}

const HANDLE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const HOLDERS: ReadonlySet<string> = new Set<LeaseHolder>(['agent', 'human', 'none']);

function invalid(what: string): ControlApiError {
	return new ControlApiError(200, 'INVALID_RESPONSE', `the ${what} does not match the contract`);
}

function parseLeaseView(body: unknown): LeaseView {
	if (typeof body !== 'object' || body === null) throw invalid('lease');
	const { state, holder, history } = body as Record<string, unknown>;
	const parsedState = LeaseStateSchema.safeParse(state);
	if (!parsedState.success || typeof holder !== 'string' || !HOLDERS.has(holder) || !Array.isArray(history)) {
		throw invalid('lease');
	}
	const transitions: LeaseTransition[] = history.map((item) => {
		const parsed = LeaseTransitionSchema.safeParse(item);
		if (!parsed.success) throw invalid('lease history');
		return parsed.data;
	});
	return { state: parsedState.data, holder: holder as LeaseHolder, history: transitions };
}

function parseRequest(body: unknown): InterventionRequest {
	const parsed = InterventionRequestSchema.safeParse(body);
	if (!parsed.success) throw invalid('intervention request');
	return parsed.data;
}

function checkHandle(operator: string): string {
	if (!HANDLE.test(operator))
		throw new SessionValidationError('operator', 'must be a lowercase handle such as "ops-1"');
	return operator;
}

/**
 * A typed HTTP client for the session's control API (`ControlServer`), used by the operator console and
 * tests. Every response is validated against the contracts (`InterventionRequestSchema`, the lease schemas);
 * any error answer becomes a `ControlApiError` carrying the status and the server's code. Operators are given
 * as handles (`ops-1`); the session records them as `operator:ops-1`.
 */
export class ControlClient {
	private readonly base: string;
	private readonly fetchImpl: typeof fetch;

	constructor(private readonly options: ControlClientOptions) {
		this.base = options.url.replace(/\/+$/, '');
		this.fetchImpl = options.fetch ?? fetch;
	}

	/** `GET /lease`. */
	async lease(): Promise<LeaseView> {
		return parseLeaseView(await this.json('GET', '/lease'));
	}

	/** `GET /interventions`. */
	async interventions(): Promise<InterventionRequest[]> {
		const body = await this.json('GET', '/interventions');
		if (!Array.isArray(body)) throw invalid('intervention list');
		return body.map(parseRequest);
	}

	/** `GET /interventions/:id`. */
	async intervention(id: string): Promise<InterventionRequest> {
		return parseRequest(await this.json('GET', `/interventions/${encodeURIComponent(id)}`));
	}

	/** `GET /evidence/:refId`: a masked screenshot, a redacted snapshot or an intervention document. */
	async evidence(refId: string): Promise<ServedEvidence> {
		const response = await this.send('GET', `/evidence/${encodeURIComponent(refId)}`);
		return {
			contentType: response.headers.get('content-type') ?? 'application/octet-stream',
			bytes: new Uint8Array(await response.arrayBuffer()),
		};
	}

	/** `POST /interventions/:id/claim`: take control of the live session (takeover). */
	async claim(id: string, operator: string): Promise<InterventionRequest> {
		return parseRequest(await this.operate(`/interventions/${encodeURIComponent(id)}/claim`, operator));
	}

	/** `POST /interventions/:id/approve`: approve the pending irreversible action. */
	async approve(id: string, operator: string): Promise<InterventionRequest> {
		return parseRequest(await this.operate(`/interventions/${encodeURIComponent(id)}/approve`, operator));
	}

	/** `POST /interventions/:id/reject`: refuse the pending irreversible action (the run ends). */
	async reject(id: string, operator: string): Promise<InterventionRequest> {
		return parseRequest(await this.operate(`/interventions/${encodeURIComponent(id)}/reject`, operator));
	}

	/** `POST /resume`: hand control back to the automation. */
	async resume(operator: string): Promise<LeaseView> {
		return parseLeaseView(await this.operate('/resume', operator));
	}

	/** `POST /abort`: end the run. */
	async abort(operator: string): Promise<LeaseView> {
		return parseLeaseView(await this.operate('/abort', operator));
	}

	private operate(route: string, operator: string): Promise<unknown> {
		return this.json('POST', route, { operator: checkHandle(operator) });
	}

	private async json(method: 'GET' | 'POST', route: string, body?: unknown): Promise<unknown> {
		const response = await this.send(method, route, body);
		try {
			return await response.json();
		} catch (cause) {
			throw new ControlApiError(response.status, 'INVALID_RESPONSE', 'the response is not JSON', { cause });
		}
	}

	private async send(method: 'GET' | 'POST', route: string, body?: unknown): Promise<Response> {
		let response: Response;
		try {
			response = await this.fetchImpl(`${this.base}${route}`, {
				method,
				headers: {
					authorization: `Bearer ${this.options.token}`,
					...(body === undefined ? {} : { 'content-type': 'application/json' }),
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			});
		} catch (cause) {
			throw new ControlApiError(0, 'UNREACHABLE', `cannot reach ${this.base}`, { cause });
		}
		if (!response.ok) {
			let code = 'HTTP_ERROR';
			let message = response.statusText;
			try {
				const error = ((await response.json()) as { error?: { code?: unknown; message?: unknown } }).error;
				if (typeof error?.code === 'string') code = error.code;
				if (typeof error?.message === 'string') message = error.message;
			} catch (cause) {
				throw new ControlApiError(response.status, code, message, { cause });
			}
			throw new ControlApiError(response.status, code, message);
		}
		return response;
	}
}
