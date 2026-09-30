import { createHash } from 'node:crypto';
import type { ElementFingerprint } from '../port/ElementFingerprint.js';

/**
 * A stable key for a target, to bind an approval grant to it: a SHA-256 over the fingerprint's identity
 * (frame path, role, name, tag, name attribute, layout anchors, container position). Hashed so the key
 * carries no UI text into grants, logs or evidence.
 */
export function fingerprintKey(fingerprint: ElementFingerprint): string {
	const identity = [
		fingerprint.framePath,
		fingerprint.role,
		fingerprint.name,
		fingerprint.tag,
		fingerprint.nameAttribute,
		fingerprint.inputType,
		fingerprint.labelCellText,
		fingerprint.rowHeaderText,
		fingerprint.columnHeaderText,
		fingerprint.container?.element ?? null,
		fingerprint.container?.index ?? null,
		fingerprint.visibleText,
	];
	return `fp:${createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 32)}`;
}
