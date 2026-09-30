import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tempRoot } from '../../test/fixtures/tempRoot.js';
import { EvidenceWriteError } from '../errors/EvidenceWriteError.js';
import { RUN_SUBDIRS, RunDirectory } from './RunDirectory.js';

const RUN_ID = 'replay-20260929T101500-a1b2';

describe('RunDirectory', () => {
	let root: string;
	let cleanup: () => Promise<void>;
	beforeEach(async () => ({ root, cleanup } = await tempRoot()));
	afterEach(() => cleanup());

	it('creates <root>/<runId>/ with an empty run.jsonl and every evidence subdirectory', async () => {
		const runDir = await RunDirectory.create(root, RUN_ID);
		expect(runDir.path).toBe(path.join(root, RUN_ID));
		expect(runDir.runId).toBe(RUN_ID);
		expect(runDir.kind).toBe('replay');
		expect(await readFile(runDir.logPath, 'utf8')).toBe('');
		expect(RUN_SUBDIRS).toEqual(['screenshots', 'snapshots', 'interventions', 'prompts']);
		for (const sub of RUN_SUBDIRS) expect((await stat(path.join(runDir.path, sub))).isDirectory()).toBe(true);
		expect(runDir.manifestPath).toBe(path.join(root, RUN_ID, 'manifest.json'));
		expect(runDir.resultPath).toBe(path.join(root, RUN_ID, 'result.json'));
		expect(runDir.artifactPath).toBe(path.join(root, RUN_ID, 'artifact.json'));
	});

	it('creates a missing root', async () => {
		const runDir = await RunDirectory.create(path.join(root, 'nested', '.runs'), RUN_ID);
		expect((await stat(runDir.path)).isDirectory()).toBe(true);
	});

	it('refuses to reuse an existing run directory', async () => {
		await mkdir(path.join(root, RUN_ID));
		await expect(RunDirectory.create(root, RUN_ID)).rejects.toMatchObject({
			code: 'EVIDENCE_WRITE_FAILED',
			constructor: EvidenceWriteError,
		});
	});

	it('rejects an invalid run id', async () => {
		await expect(RunDirectory.create(root, '../escape')).rejects.toMatchObject({ code: 'EVIDENCE_INVALID' });
	});

	it('resolves run-relative paths and refuses paths that leave the run', async () => {
		const runDir = await RunDirectory.create(root, RUN_ID);
		expect(runDir.resolve('screenshots/0001.png')).toBe(path.join(root, RUN_ID, 'screenshots', '0001.png'));
		expect(() => runDir.resolve('../other/run.jsonl')).toThrow(expect.objectContaining({ code: 'EVIDENCE_INVALID' }));
		expect(() => runDir.resolve('/etc/passwd')).toThrow(expect.objectContaining({ code: 'EVIDENCE_INVALID' }));
	});

	it('opens an existing run directory', async () => {
		await RunDirectory.create(root, RUN_ID);
		const opened = await RunDirectory.open(root, RUN_ID);
		expect(opened.path).toBe(path.join(root, RUN_ID));
		await expect(RunDirectory.open(root, 'replay-20260929T101500-ffff')).rejects.toMatchObject({
			code: 'EVIDENCE_READ_FAILED',
		});
	});
});
