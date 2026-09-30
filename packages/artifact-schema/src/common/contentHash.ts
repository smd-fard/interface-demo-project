import { CanonicalizationError } from './CanonicalizationError.js';
import type { ContentHash } from './Identifiers.js';

function normalize(value: unknown, path: string): unknown {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new CanonicalizationError(path, String(value));
		return value;
	}
	if (Array.isArray(value)) {
		// Like JSON: an undefined array slot becomes null.
		return value.map((item, index) => (item === undefined ? null : normalize(item, `${path}[${index}]`)));
	}
	if (typeof value === 'object') {
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(value).sort()) {
			const child = (value as Record<string, unknown>)[key];
			if (child !== undefined) sorted[key] = normalize(child, `${path}.${key}`);
		}
		return sorted;
	}
	throw new CanonicalizationError(path, typeof value);
}

/**
 * Deterministic JSON: object keys sorted recursively, array order kept, undefined properties omitted.
 * @throws CanonicalizationError for a value JSON cannot represent (NaN, Infinity, bigint, function, symbol).
 */
export function canonicalize(value: unknown): string {
	return JSON.stringify(normalize(value, '$'));
}

/**
 * sha256 over the canonical JSON of an artifact with its top-level `contentHash` excluded. Uses Web Crypto
 * (`globalThis.crypto.subtle`), so it runs unchanged in Node, browsers and any other surface host.
 * @throws CanonicalizationError for a value JSON cannot represent.
 */
export async function computeContentHash(artifact: Readonly<Record<string, unknown>>): Promise<ContentHash> {
	const content: Record<string, unknown> = { ...artifact };
	delete content['contentHash'];
	const bytes = new TextEncoder().encode(canonicalize(content));
	const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
	const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
	return `sha256:${hex}`;
}
