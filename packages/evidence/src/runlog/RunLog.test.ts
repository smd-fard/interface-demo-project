import { readFile } from 'node:fs/promises';
import { RunLogEntrySchema, type RunLogEntryInput } from '@idp/artifact-schema';
import { createRedactor, type Redactor } from '@idp/policy';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tempRoot } from '../../test/fixtures/tempRoot.js';
import { EvidenceValidationError } from '../errors/EvidenceValidationError.js';
import { RunDirectory } from '../runs/RunDirectory.js';
import { RunLog } from './RunLog.js';

// Synthetic values only.
const MEMBER_ID = '48213';
const PASSWORD = 'hunter2-synthetic';
const RUN_ID = 'discovery-20260929T101500-a1b2';
const AT = '2026-09-29T10:15:00.000Z';

function redactor(): Redactor {
	return createRedactor({ sensitiveValues: [{ value: MEMBER_ID, paramName: 'memberId' }, PASSWORD] });
}

const observation = (digest: string): RunLogEntryInput => ({
	kind: 'observation',
	at: AT,
	runId: RUN_ID,
	actor: 'agent',
	url: `http://127.0.0.1:43210/member?id=${MEMBER_ID}`,
	title: 'Member Inquiry',
	digest,
	snapshotRef: null,
	screenshotRef: null,
});

describe('RunLog', () => {
	let root: string;
	let cleanup: () => Promise<void>;
	let runDir: RunDirectory;
	beforeEach(async () => {
		({ root, cleanup } = await tempRoot());
		runDir = await RunDirectory.create(root, RUN_ID);
	});
	afterEach(() => cleanup());

	it('never writes a sensitive param or credential value to the file', async () => {
		const log = RunLog.create(runDir, redactor());
		log.log(observation(`Member ${MEMBER_ID} found; password field holds ${PASSWORD}; SSN 123-45-6789`));
		log.log({
			kind: 'decision',
			at: AT,
			runId: RUN_ID,
			actor: 'agent',
			reason: `Search for member ${MEMBER_ID}`,
			tool: 'fill',
			input: { value: MEMBER_ID, nested: { password: PASSWORD } },
		});
		await log.close();
		const text = await readFile(runDir.logPath, 'utf8');
		expect(text).not.toContain(MEMBER_ID);
		expect(text).not.toContain(PASSWORD);
		expect(text).not.toContain('123-45-6789');
		expect(text).toContain('[REDACTED]');
	});

	it('writes one schema-valid JSON line per entry with a gap-free, monotonic seq', async () => {
		const log = RunLog.create(runDir, redactor());
		const first = log.log(observation('Sign On screen'));
		const second = log.log(observation('Main menu'));
		log.log({
			kind: 'action',
			at: AT,
			runId: RUN_ID,
			actor: 'agent',
			actionKind: 'click',
			risk: 'reversible',
			durationMs: 12345,
		});
		expect(first.seq).toBe(1);
		expect(second.seq).toBe(2);
		await log.close();
		const lines = (await readFile(runDir.logPath, 'utf8')).trimEnd().split('\n');
		expect(lines).toHaveLength(3);
		const entries = lines.map((line) => RunLogEntrySchema.parse(JSON.parse(line)));
		expect(entries.map((entry) => entry.seq)).toEqual([1, 2, 3]);
	});

	it('keeps structural fields (ids, timestamps, numbers, origins) intact while redacting free text', async () => {
		const log = RunLog.create(runDir, redactor());
		log.log({
			kind: 'run_started',
			at: AT,
			runId: RUN_ID,
			actor: 'agent',
			runKind: 'discovery',
			artifact: null,
			goal: `Look up member ${MEMBER_ID}`,
			origin: 'http://127.0.0.1:43210',
		});
		log.log({
			kind: 'action',
			at: AT,
			runId: RUN_ID,
			actor: 'agent',
			actionKind: 'fill',
			risk: 'reversible',
			target: `Member number field (${MEMBER_ID})`,
			durationMs: 48213,
		});
		await log.close();
		const [started, action] = await RunLog.read(runDir.logPath);
		expect(started).toMatchObject({ origin: 'http://127.0.0.1:43210', goal: 'Look up member [REDACTED]' });
		expect(action).toMatchObject({ durationMs: 48213, target: 'Member number field ([REDACTED])' });
	});

	it('keeps decision model-response metadata verbatim (5-digit token counts are not member numbers)', async () => {
		const log = RunLog.create(runDir, redactor());
		const modelResponse = {
			responseId: 'msg_01XFDUDYJgAACzvnptvVoYEL',
			model: 'claude-sonnet-5-5',
			stopReason: 'tool_use',
			usage: { inputTokens: 12345, outputTokens: 48213, cacheReadInputTokens: 11000, cacheCreationInputTokens: 0 },
			latencyMs: 23456,
		};
		log.log({
			kind: 'decision',
			at: AT,
			runId: RUN_ID,
			actor: 'agent',
			reason: `Search for member ${MEMBER_ID}`,
			tool: 'fill',
			input: { value: MEMBER_ID },
			modelResponse,
		});
		await log.close();
		const [decision] = await RunLog.read(runDir.logPath);
		expect(decision).toMatchObject({ modelResponse, reason: 'Search for member [REDACTED]' });
	});

	it('masks a balance in free text (money-amount rule) and keeps numeric fields as numbers', async () => {
		const log = RunLog.create(runDir, redactor());
		log.log(observation('Member Inquiry: Checking 842.10, Share Savings $1,523.47'));
		log.log({
			kind: 'action',
			at: AT,
			runId: RUN_ID,
			actor: 'agent',
			actionKind: 'extract',
			risk: 'read',
			target: 'Share Savings balance cell (1523.47)',
			durationMs: 1523,
		});
		await log.close();
		const text = await readFile(runDir.logPath, 'utf8');
		expect(text).not.toMatch(/842\.10|1,?523\.47/);
		const [observed, action] = await RunLog.read(runDir.logPath);
		expect(observed).toMatchObject({ digest: 'Member Inquiry: Checking [REDACTED], Share Savings [REDACTED]' });
		expect(action).toMatchObject({ durationMs: 1523, target: 'Share Savings balance cell ([REDACTED])' });
	});

	it('flushes every entry by close and reads them back validated', async () => {
		const log = RunLog.create(runDir, redactor());
		for (let index = 0; index < 50; index += 1) log.log(observation(`screen ${index}`));
		await log.close();
		const entries = await RunLog.read(runDir.logPath);
		expect(entries).toHaveLength(50);
		expect(entries.at(-1)?.seq).toBe(50);
		expect(await log.entries()).toEqual(entries);
	});

	it('rejects an invalid entry with EVIDENCE_INVALID and does not consume a seq', async () => {
		const log = RunLog.create(runDir, redactor());
		expect(() => log.log({ ...observation('x'), runId: 'replay-20260929T101500-a1b2' } as RunLogEntryInput)).toThrow(
			EvidenceValidationError,
		);
		expect(log.log(observation('ok')).seq).toBe(1);
		await log.close();
	});

	it('refuses writes after close', async () => {
		const log = RunLog.create(runDir, redactor());
		await log.close();
		expect(() => log.log(observation('late'))).toThrow(expect.objectContaining({ code: 'EVIDENCE_WRITE_FAILED' }));
	});

	it('reports a corrupt line when reading', async () => {
		const log = RunLog.create(runDir, redactor());
		log.log(observation('ok'));
		await log.close();
		const { appendFile } = await import('node:fs/promises');
		await appendFile(runDir.logPath, '{"kind":"nope"}\n');
		await expect(RunLog.read(runDir.logPath)).rejects.toMatchObject({ code: 'EVIDENCE_INVALID' });
	});

	it('has no public method that accepts unredacted entries', () => {
		const log = RunLog.create(runDir, redactor());
		// @ts-expect-error append is private: the only public write path redacts first (invariant 3)
		expect(typeof log.append).toBe('function');
		return log.close();
	});
});
