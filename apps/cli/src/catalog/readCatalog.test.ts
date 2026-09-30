import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readCatalog } from './readCatalog.js';

const ARTIFACTS = path.resolve(import.meta.dirname, '../../../../artifacts');

describe('readCatalog', () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), 'idp-cli-catalog-'));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('lists the repo artifacts, all verified, with params and outputs', async () => {
		const entries = await readCatalog(ARTIFACTS);
		expect(entries.map((entry) => [entry.id, entry.status])).toEqual([
			['member-lookup', 'verified'],
			['open-sub-account', 'verified'],
		]);
		expect(entries[0]?.params).toEqual([{ name: 'memberId', type: 'string', sensitive: true, required: true }]);
		expect(entries[0]?.outputs.map((output) => output.name)).toContain('savingsBalance');
	});

	it('reports mismatch for an edited artifact and invalid for a non-artifact', async () => {
		const edited = JSON.parse(await readFile(path.join(ARTIFACTS, 'member-lookup.json'), 'utf8')) as {
			title: string;
		};
		edited.title = 'Edited after hashing';
		await writeFile(path.join(dir, 'a-edited.json'), JSON.stringify(edited));
		await writeFile(path.join(dir, 'b-junk.json'), '{"not":"an artifact"}');
		await writeFile(path.join(dir, 'c-broken.json'), '{ nope');
		await copyFile(path.join(ARTIFACTS, 'open-sub-account.json'), path.join(dir, 'd-ok.json'));
		await writeFile(path.join(dir, 'README.md'), 'ignored');
		expect((await readCatalog(dir)).map((entry) => [entry.file, entry.status])).toEqual([
			['a-edited.json', 'mismatch'],
			['b-junk.json', 'invalid'],
			['c-broken.json', 'invalid'],
			['d-ok.json', 'verified'],
		]);
	});
});
