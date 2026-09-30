import type { OutgoingHttpHeaders, ServerResponse } from 'node:http';

const NO_CACHE = { 'cache-control': 'no-store', pragma: 'no-cache' };

/** Sends an HTML page with the given status (and extra headers). */
export function sendHtml(res: ServerResponse, status: number, html: string, headers: OutgoingHttpHeaders = {}): void {
	res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...NO_CACHE, ...headers });
	res.end(html);
}

/** Sends a plain-text body. */
export function sendText(res: ServerResponse, status: number, text: string): void {
	res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...NO_CACHE });
	res.end(text);
}

/** Sends a JSON body. */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { 'content-type': 'application/json', ...NO_CACHE });
	res.end(JSON.stringify(body));
}

/** Sends an empty response (default 204). */
export function sendEmpty(res: ServerResponse, status = 204): void {
	res.writeHead(status, NO_CACHE);
	res.end();
}

/** A redirect. 302 for GET-style navigation, 303 after a form POST. */
export function redirect(
	res: ServerResponse,
	status: 302 | 303,
	location: string,
	headers: OutgoingHttpHeaders = {},
): void {
	res.writeHead(status, { location, ...NO_CACHE, ...headers });
	res.end();
}
