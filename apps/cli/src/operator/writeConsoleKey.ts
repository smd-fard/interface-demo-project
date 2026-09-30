import { randomBytes } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** The file (mode 0600, next to the control token) holding the operator console's one-time login key. */
export const CONSOLE_KEY = 'operator.key';

const KEY_LENGTH = 40;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * A new console login key: 40 random letters (≈ 228 bits) from system randomness. Letters only, so no redaction
 * pattern (digit runs, amounts) can ever mask part of the printed login URL. Never derived from the control token.
 */
export function newConsoleKey(): string {
	let key = '';
	while (key.length < KEY_LENGTH) {
		for (const byte of randomBytes(KEY_LENGTH)) {
			// 52 × 4 = 208: rejecting 208–255 keeps every letter equally likely.
			if (byte < 208 && key.length < KEY_LENGTH) key += LETTERS[byte % 52];
		}
	}
	return key;
}

/**
 * Writes a new console login key to `<dir>/operator.key` (mode 0600, replacing an older one) and returns it with
 * the file path. The key is not the control token: the console exchanges it once for a session cookie.
 */
export async function writeConsoleKey(dir: string): Promise<{ readonly key: string; readonly keyFile: string }> {
	const key = newConsoleKey();
	const keyFile = path.join(dir, CONSOLE_KEY);
	await rm(keyFile, { force: true });
	await writeFile(keyFile, key, { mode: 0o600, flag: 'wx' });
	return { key, keyFile };
}

/** Removes the key file once the console has exited (the key dies with the console process). */
export async function removeConsoleKey(keyFile: string): Promise<void> {
	await rm(keyFile, { force: true });
}
