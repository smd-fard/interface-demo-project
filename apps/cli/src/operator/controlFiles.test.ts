import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findLatestControl } from './findLatestControl.js';
import { removeControlFiles, writeControlFiles } from './writeControlFiles.js';

describe('control files of an attended session', () => {
	let root: string;
	beforeEach(async () => {
		root = await mkdtemp(path.join(tmpdir(), 'idp-cli-control-'));
	});
	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it('writes the token to a 0600 control.token and control.json without the token', async () => {
		const runDir = path.join(root, 'replay-a');
		await mkdir(runDir);
		const files = await writeControlFiles(runDir, { controlUrl: 'http://127.0.0.1:4020', controlToken: 'tok-abc' });
		expect(files.tokenFile).toBe(path.join(runDir, 'control.token'));
		expect(await readFile(files.tokenFile, 'utf8')).toBe('tok-abc');
		expect((await stat(files.tokenFile)).mode & 0o777).toBe(0o600);
		const json = await readFile(files.controlFile, 'utf8');
		expect(json).not.toContain('tok-abc');
		expect(JSON.parse(json)).toEqual({ controlUrl: 'http://127.0.0.1:4020', tokenFile: files.tokenFile });
		await removeControlFiles(runDir);
		await expect(stat(files.tokenFile)).rejects.toThrow();
		await expect(stat(files.controlFile)).rejects.toThrow();
	});

	it('finds the most recent control.json under the runs root', async () => {
		for (const [name, seconds] of [
			['replay-old', 1_000],
			['replay-new', 2_000],
		] as const) {
			const dir = path.join(root, name);
			await mkdir(dir);
			await writeControlFiles(dir, { controlUrl: `http://127.0.0.1:${seconds}`, controlToken: 't' });
			await utimes(path.join(dir, 'control.json'), seconds, seconds);
		}
		await mkdir(path.join(root, 'replay-none'));
		await writeFile(path.join(root, 'stray.txt'), 'x');
		expect(await findLatestControl(root)).toEqual({
			controlUrl: 'http://127.0.0.1:2000',
			tokenFile: path.join(root, 'replay-new', 'control.token'),
		});
	});

	it('returns null when no attended session is running (or the root is missing)', async () => {
		expect(await findLatestControl(root)).toBeNull();
		expect(await findLatestControl(path.join(root, 'missing'))).toBeNull();
	});
});
