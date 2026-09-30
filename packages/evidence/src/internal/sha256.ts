import { createHash } from 'node:crypto';

/** SHA-256 of `bytes` as 64 lowercase hex characters (the EvidenceRef format, no prefix). */
export function sha256(bytes: Uint8Array | string): string {
	return createHash('sha256').update(bytes).digest('hex');
}
