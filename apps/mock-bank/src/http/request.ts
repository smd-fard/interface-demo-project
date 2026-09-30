import type { IncomingMessage } from 'node:http';
import { RequestBodyError } from '../errors/RequestBodyError.js';

const MAX_BODY_BYTES = 64 * 1024;

/** Reads the raw request body (at most 64 KiB). */
export async function readBody(req: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = chunk as Buffer;
		size += buffer.length;
		if (size > MAX_BODY_BYTES) throw new RequestBodyError('request body too large', 413);
		chunks.push(buffer);
	}
	return Buffer.concat(chunks).toString('utf8');
}

/** Reads an `application/x-www-form-urlencoded` body. */
export async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
	return new URLSearchParams(await readBody(req));
}

/** Reads a JSON body; an empty body is `{}`. */
export async function readJson(req: IncomingMessage): Promise<unknown> {
	const text = await readBody(req);
	if (text.trim() === '') return {};
	try {
		return JSON.parse(text) as unknown;
	} catch (error) {
		throw new RequestBodyError(`invalid JSON body: ${(error as Error).message}`, 400);
	}
}

/** The value of one cookie from the `Cookie` header. */
export function readCookie(req: IncomingMessage, name: string): string | undefined {
	for (const part of (req.headers.cookie ?? '').split(';')) {
		const [key, ...rest] = part.trim().split('=');
		if (key === name) return rest.join('=');
	}
	return undefined;
}
