import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EvidenceRefSchema, type EvidenceRef } from '@idp/artifact-schema';
import { asMaskedScreenshot, createRedactor } from '@idp/policy';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tempRoot } from '../../test/fixtures/tempRoot.js';
import { RunDirectory } from '../runs/RunDirectory.js';
import { EvidenceStore } from './EvidenceStore.js';

const RUN_ID = 'replay-20260929T101500-a1b2';
const MEMBER_ID = '48213';
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const PNG = asMaskedScreenshot(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));

describe('EvidenceStore', () => {
	let root: string;
	let cleanup: () => Promise<void>;
	let runDir: RunDirectory;
	let store: EvidenceStore;
	const redactor = createRedactor({ sensitiveValues: [{ value: MEMBER_ID, paramName: 'memberId' }] });

	beforeEach(async () => {
		({ root, cleanup } = await tempRoot());
		runDir = await RunDirectory.create(root, RUN_ID);
		store = new EvidenceStore(runDir);
	});
	afterEach(() => cleanup());

	async function expectStored(ref: EvidenceRef) {
		expect(EvidenceRefSchema.parse(ref)).toEqual(ref);
		const bytes = await readFile(runDir.resolve(ref.path));
		expect(ref.sha256).toBe(sha(bytes));
		return bytes;
	}

	it('stores a masked screenshot as a PNG under screenshots/ with a sequential id and its sha256', async () => {
		const first = await store.putScreenshot(PNG);
		const second = await store.putScreenshot(PNG, { label: 's06-click-search' });
		expect(first).toMatchObject({ id: 'screenshot-0001', kind: 'screenshot', path: 'screenshots/0001.png' });
		expect(second).toMatchObject({ id: 'screenshot-0002', path: 'screenshots/0002-s06-click-search.png' });
		expect(first.localOnly).toBe(false);
		expect(first.redacted).toBe(true);
		expect(await expectStored(first)).toEqual(Buffer.from(PNG));
		expect(first.sha256).toBe(sha(PNG));
	});

	it('stores a redacted a11y snapshot as JSON under snapshots/', async () => {
		const tree = redactor.redact({ role: 'WebArea', children: [{ role: 'cell', name: `Member ${MEMBER_ID}` }] });
		const ref = await store.putA11ySnapshot(tree);
		expect(ref).toMatchObject({ id: 'a11y-snapshot-0001', kind: 'a11y_snapshot', path: 'snapshots/0001.json' });
		const text = (await expectStored(ref)).toString('utf8');
		expect(text).not.toContain(MEMBER_ID);
		expect(JSON.parse(text)).toEqual(tree);
	});

	it('stores redacted JSON documents at the run root or in an allowed subdirectory', async () => {
		const request = await store.putJson('ir-20260929T101500-beef', redactor.redact({ reason: 'x' }), 'interventions');
		const prompt = await store.putJson('turn-01', redactor.placeholderize({ text: `find ${MEMBER_ID}` }), 'prompts');
		const plain = await store.putJson('summary', redactor.redact({ ok: true }));
		expect(request).toMatchObject({
			id: 'json-0001',
			kind: 'json',
			path: 'interventions/ir-20260929T101500-beef.json',
		});
		expect(prompt.path).toBe('prompts/turn-01.json');
		expect(plain.path).toBe('summary.json');
		expect(JSON.parse((await expectStored(prompt)).toString('utf8'))).toEqual({ text: 'find {{memberId}}' });
		await expectStored(request);
		await expectStored(plain);
	});

	it('refuses unsafe or reserved JSON names and overwriting', async () => {
		const doc = redactor.redact({});
		await expect(store.putJson('../escape', doc)).rejects.toMatchObject({ code: 'EVIDENCE_INVALID' });
		await expect(store.putJson('manifest', doc)).rejects.toMatchObject({ code: 'EVIDENCE_INVALID' });
		await store.putJson('once', doc);
		await expect(store.putJson('once', doc)).rejects.toMatchObject({ code: 'EVIDENCE_WRITE_FAILED' });
	});

	it('copies a trace under the run directory and marks it localOnly', async () => {
		const source = path.join(root, 'trace.zip');
		await writeFile(source, 'fake trace bytes');
		const ref = await store.putLocalOnly(source);
		expect(ref).toMatchObject({ id: 'trace-0001', kind: 'trace', path: 'traces/0001-trace.zip', localOnly: true });
		expect((await expectStored(ref)).toString('utf8')).toBe('fake trace bytes');
	});

	it('wraps a missing trace file in EVIDENCE_WRITE_FAILED with the cause', async () => {
		const error = await store.putLocalOnly(path.join(root, 'missing.zip')).catch((caught: unknown) => caught);
		expect(error).toMatchObject({ code: 'EVIDENCE_WRITE_FAILED' });
		expect((error as Error).cause).toBeDefined();
	});

	it('gets a ref with its absolute path, lists refs in order, and notifies onPut', async () => {
		const seen: string[] = [];
		store = new EvidenceStore(runDir, { onPut: (ref) => seen.push(ref.id) });
		const shot = await store.putScreenshot(PNG);
		const snap = await store.putA11ySnapshot(redactor.redact({ role: 'WebArea' }));
		expect(store.get(shot.id)).toEqual({ ref: shot, absolutePath: path.join(runDir.path, 'screenshots', '0001.png') });
		expect(store.get('screenshot-9999')).toBeUndefined();
		expect(store.list()).toEqual([shot, snap]);
		expect(seen).toEqual(['screenshot-0001', 'a11y-snapshot-0001']);
	});

	it('accepts only masked screenshots and redacted documents at compile time', async () => {
		// @ts-expect-error plain bytes are not a MaskedScreenshot (invariant 3)
		await store.putScreenshot(new Uint8Array([1]));
		// @ts-expect-error an unredacted object is not Redacted<unknown> (invariant 3)
		await store.putJson('raw', { note: 'not redacted' });
		// the runtime still stored them above; the guard is the brand, checked by tsc
		expect(store.list()).toHaveLength(2);
	});
});
