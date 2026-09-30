import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newConsoleKey, removeConsoleKey, writeConsoleKey } from './writeConsoleKey.js';

describe('the operator console login key', () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), 'idp-cli-key-'));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('is 40 random letters, different every time', () => {
		const keys = new Set(Array.from({ length: 50 }, () => newConsoleKey()));
		expect(keys.size).toBe(50);
		for (const key of keys) expect(key).toMatch(/^[A-Za-z]{40}$/);
	});

	it('is written to a 0600 operator.key (replacing an old one) and removed afterwards', async () => {
		await writeConsoleKey(dir);
		const { key, keyFile } = await writeConsoleKey(dir);
		expect(keyFile).toBe(path.join(dir, 'operator.key'));
		expect(await readFile(keyFile, 'utf8')).toBe(key);
		expect((await stat(keyFile)).mode & 0o777).toBe(0o600);
		await removeConsoleKey(keyFile);
		await expect(stat(keyFile)).rejects.toThrow();
	});
});
