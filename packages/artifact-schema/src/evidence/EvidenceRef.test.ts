import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EvidenceIdSchema, EvidenceRefSchema, RunRelativePathSchema } from './EvidenceRef.js';

const ref = {
	id: 'screenshot-0003',
	kind: 'screenshot',
	path: 'screenshots/0003-s06-click-search.png',
	sha256: 'a'.repeat(64),
	redacted: true,
	localOnly: false,
};

describe('EvidenceRefSchema', () => {
	it('accepts a redacted screenshot ref', () => {
		expect(EvidenceRefSchema.parse(ref)).toEqual(ref);
	});

	it.each(['screenshot', 'a11y_snapshot', 'trace', 'json', 'log'])('accepts the kind %s', (kind) => {
		expect(EvidenceRefSchema.safeParse({ ...ref, kind }).success).toBe(true);
	});

	it('cannot represent an unredacted ref (redacted is the literal true)', () => {
		const result = EvidenceRefSchema.safeParse({ ...ref, redacted: false });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['redacted']);
	});

	it('rejects a missing field, an unknown kind and an unknown key (e.g. an inline raw value)', () => {
		const missing: Record<string, unknown> = { ...ref };
		delete missing.sha256;
		expect(EvidenceRefSchema.safeParse(missing).success).toBe(false);
		expect(EvidenceRefSchema.safeParse({ ...ref, kind: 'video' }).success).toBe(false);
		expect(EvidenceRefSchema.safeParse({ ...ref, content: 'password=hunter2' }).success).toBe(false);
	});

	it.each(['A'.repeat(64), 'a'.repeat(63), `sha256:${'a'.repeat(64)}`])('rejects the sha256 %s', (sha256) => {
		expect(EvidenceRefSchema.safeParse({ ...ref, sha256 }).success).toBe(false);
	});

	it('exports to JSON Schema', () => {
		expect(() => z.toJSONSchema(EvidenceRefSchema)).not.toThrow();
	});
});

describe('RunRelativePathSchema', () => {
	it.each(['run.jsonl', 'screenshots/0003.png', 'interventions/ir-20260929T101500-beef.json', 'a/b-c_d.e/f'])(
		'accepts %s',
		(path) => {
			expect(RunRelativePathSchema.safeParse(path).success).toBe(true);
		},
	);

	it.each(['/etc/passwd', '../secrets.txt', 'a/../../b', 'a\\b', 'http://host/x', '', 'a//b', './a', 'a/'])(
		'rejects %j',
		(path) => {
			expect(RunRelativePathSchema.safeParse(path).success).toBe(false);
		},
	);
});

describe('EvidenceIdSchema', () => {
	it.each(['screenshot-0003', 'a11y-0001', 'trace'])('accepts %s', (id) => {
		expect(EvidenceIdSchema.safeParse(id).success).toBe(true);
	});
	it.each(['Screenshot', 'shot_1', '', '-a', 'a b'])('rejects %j', (id) => {
		expect(EvidenceIdSchema.safeParse(id).success).toBe(false);
	});
});
