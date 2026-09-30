import type { IncomingMessage } from 'node:http';
import { OperatorHttpError } from '../errors/OperatorHttpError.js';

/** The largest form body the console accepts. */
export const MAX_FORM_BYTES = 8 * 1024;

/** Reads an `application/x-www-form-urlencoded` body (415 otherwise, 413 above `MAX_FORM_BYTES`). */
export async function readForm(request: IncomingMessage): Promise<URLSearchParams> {
	const type = (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
	if (type !== 'application/x-www-form-urlencoded') {
		throw new OperatorHttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'actions are posted as url-encoded forms');
	}
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = chunk as Buffer;
		size += buffer.length;
		if (size > MAX_FORM_BYTES) {
			throw new OperatorHttpError(413, 'PAYLOAD_TOO_LARGE', `the form exceeds ${MAX_FORM_BYTES} bytes`);
		}
		chunks.push(buffer);
	}
	return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}
