import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { RunManifestSchema } from './RunManifest.js';

const ref = {
	id: 'screenshot-0001',
	kind: 'screenshot',
	path: 'screenshots/0001.png',
	sha256: 'e'.repeat(64),
	redacted: true,
	localOnly: false,
};

const manifest = {
	runId: 'replay-20260929T101500-a1b2',
	kind: 'replay',
	startedAt: '2026-09-29T10:15:00.000Z',
	endedAt: '2026-09-29T10:15:04.210Z',
	artifact: { id: 'member-lookup', version: '1.0.0', contentHash: `sha256:${'0'.repeat(64)}` },
	resultKind: 'success',
	evidence: [ref, { ...ref, id: 'trace', kind: 'trace', path: 'trace.zip', localOnly: true }],
	logPath: 'run.jsonl',
	redactionRulesVersion: '1.0.0',
};

describe('RunManifestSchema', () => {
	it('accepts a finished replay manifest', () => {
		expect(RunManifestSchema.parse(manifest)).toEqual(manifest);
	});

	it('accepts an unfinished discovery manifest with no artifact yet', () => {
		const running = {
			...manifest,
			runId: 'discovery-20260929T085900-c0de',
			kind: 'discovery',
			endedAt: null,
			artifact: null,
			resultKind: null,
			evidence: [],
		};
		expect(RunManifestSchema.safeParse(running).success).toBe(true);
	});

	it('rejects a missing field', () => {
		const missing: Record<string, unknown> = { ...manifest };
		delete missing.redactionRulesVersion;
		const result = RunManifestSchema.safeParse(missing);
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['redactionRulesVersion']);
	});

	it('rejects an unknown kind, an unknown result kind and an unknown key (raw secret)', () => {
		expect(RunManifestSchema.safeParse({ ...manifest, kind: 'dry_run' }).success).toBe(false);
		expect(RunManifestSchema.safeParse({ ...manifest, resultKind: 'recoverable' }).success).toBe(false);
		expect(RunManifestSchema.safeParse({ ...manifest, credentials: { password: 'hunter2' } }).success).toBe(false);
	});

	it('rejects an unredacted ref, a log path outside the run and duplicate evidence ids', () => {
		expect(RunManifestSchema.safeParse({ ...manifest, evidence: [{ ...ref, redacted: false }] }).success).toBe(false);
		expect(RunManifestSchema.safeParse({ ...manifest, logPath: '../other/run.jsonl' }).success).toBe(false);
		const dup = RunManifestSchema.safeParse({ ...manifest, evidence: [ref, ref] });
		expect(dup.success).toBe(false);
		expect(dup.error?.issues[0]?.path).toEqual(['evidence', 1, 'id']);
	});

	it('keeps kind, times and result consistent', () => {
		const kind = RunManifestSchema.safeParse({ ...manifest, kind: 'discovery' });
		expect(kind.error?.issues[0]?.path).toEqual(['kind']);
		const backwards = RunManifestSchema.safeParse({ ...manifest, endedAt: '2026-09-29T10:14:00.000Z' });
		expect(backwards.error?.issues[0]?.path).toEqual(['endedAt']);
		const resultWithoutEnd = RunManifestSchema.safeParse({ ...manifest, endedAt: null });
		expect(resultWithoutEnd.error?.issues[0]?.path).toEqual(['resultKind']);
	});

	it('exports to JSON Schema', () => {
		expect(() => z.toJSONSchema(RunManifestSchema)).not.toThrow();
	});
});
