import { RunResultSchema, type OutputSpec, type RunResult } from '@idp/artifact-schema';
import { createRedactor, DEFAULT_REDACTION_CONFIG, FULL_MASK } from '@idp/policy';
import { describe, expect, it } from 'vitest';
import { EXIT, exitCodeFor } from '../cli/exitCodes.js';
import { Printer } from './Printer.js';
import { printResult, summarize } from './printResult.js';

const RAW = ['12345', 'Jane Sample', '1523.47', 'teller01', 'synthetic-pass-01'];
const ARTIFACT = { id: 'member-lookup', version: '1.0.1', contentHash: `sha256:${'a'.repeat(64)}` } as const;
const OUTPUTS: OutputSpec[] = [
	{ name: 'savingsBalance', description: 'Balance.', type: { kind: 'decimal', scale: 2 }, sensitive: true },
	{ name: 'memberName', description: 'Name.', type: { kind: 'string' }, sensitive: true },
	{ name: 'status', description: 'Status.', type: { kind: 'string' }, sensitive: false },
];

function capture() {
	let stdout = '';
	let stderr = '';
	const redactor = createRedactor({ config: { redaction: DEFAULT_REDACTION_CONFIG }, sensitiveValues: [] });
	redactor.addSensitiveValue({ value: '12345', paramName: 'memberId' });
	redactor.addSensitiveValue('teller01');
	redactor.addSensitiveValue('synthetic-pass-01');
	redactor.addSensitiveValue('1523.47');
	const printer = new Printer(
		{ write: (chunk: string) => ((stdout += chunk), true) },
		{ write: (chunk: string) => ((stderr += chunk), true) },
		redactor,
	);
	return { printer, redactor, out: () => stdout, err: () => stderr };
}

const SUCCESS: RunResult = {
	kind: 'success',
	runId: 'replay-20260929T101500-a1b2',
	artifact: ARTIFACT,
	outputs: { savingsBalance: '1523.47', memberName: 'Jane Sample', status: 'Active member 12345' },
	durationMs: 12346,
	drift: [],
	recoveries: 1,
};

const OUTCOME: RunResult = {
	kind: 'business_outcome',
	runId: 'replay-20260929T101500-a1b2',
	artifact: ARTIFACT,
	code: 'member_not_found',
	message: 'No records match your search criteria for 12345',
	stepId: 's06-click-search',
};

const FAILURE: RunResult = {
	kind: 'failure',
	runId: 'replay-20260929T101500-a1b2',
	artifact: ARTIFACT,
	reason: 'checkpoint_failed',
	step: { index: 5, id: 's06-click-search' },
	expected: 'Member Inquiry for Jane Sample',
	observed: 'Sign On as teller01 / synthetic-pass-01',
	evidence: [],
};

describe('printResult', () => {
	it.each([SUCCESS, OUTCOME, FAILURE])(
		'prints a redacted, schema-valid JSON result and a summary ($kind)',
		(result) => {
			const { printer, redactor, out } = capture();
			printResult(printer, { result, redactor, outputs: OUTPUTS, runDir: '/runs/replay-x' });
			const text = out();
			for (const raw of RAW) expect(text, `stdout leaks ${raw}`).not.toContain(raw);
			const json = text.slice(0, text.lastIndexOf('}') + 1);
			const parsed = RunResultSchema.parse(JSON.parse(json));
			expect(parsed.kind).toBe(result.kind);
			expect(parsed.runId).toBe(result.runId);
			expect(text).toContain('run dir: /runs/replay-x');
		},
	);

	it('masks sensitive outputs fully and still redacts non-sensitive ones', () => {
		const { printer, redactor, out } = capture();
		printResult(printer, { result: SUCCESS, redactor, outputs: OUTPUTS, runDir: '/r' });
		const parsed = RunResultSchema.parse(JSON.parse(out().slice(0, out().lastIndexOf('}') + 1)));
		if (parsed.kind !== 'success') throw new Error('expected success');
		expect(parsed.outputs['savingsBalance']).toBe(FULL_MASK);
		expect(parsed.outputs['memberName']).toBe(FULL_MASK);
		expect(parsed.outputs['status']).toContain('Active member');
		expect(parsed.outputs['status']).not.toContain('12345');
		// Structural fields stay verbatim (a 5-digit duration is not a member number).
		expect(parsed.kind === 'success' && parsed.durationMs).toBe(12346);
	});
});

describe('summarize', () => {
	it('gives one line per result kind, naming the artifact and the outcome, with durations in seconds', () => {
		const { redactor } = capture();
		expect(summarize(SUCCESS, redactor, OUTPUTS)).toMatch(
			/^success: member-lookup@1\.0\.1 in 12\.3 s, 1 recovery; outputs: savingsBalance=\[REDACTED\], memberName=\[REDACTED\], status=/,
		);
		expect(summarize(OUTCOME, redactor, OUTPUTS)).toMatch(/^business outcome: member_not_found at s06-click-search/);
		expect(summarize(FAILURE, redactor, OUTPUTS)).toMatch(/^failure: checkpoint_failed at step 6 \(s06-click-search\)/);
		for (const result of [SUCCESS, OUTCOME, FAILURE]) {
			const line = summarize(result, redactor, OUTPUTS);
			expect(line).not.toContain('\n');
			for (const raw of RAW) expect(line).not.toContain(raw);
		}
	});
});

describe('Printer', () => {
	it('redacts every line on stdout and stderr with the current redactor', () => {
		const { printer, out, err } = capture();
		printer.line('member 12345 signed on as teller01');
		printer.error('password synthetic-pass-01 rejected for Jane Sample');
		for (const raw of RAW) {
			expect(out()).not.toContain(raw);
			expect(err()).not.toContain(raw);
		}
		expect(out()).toMatch(/\n$/);
	});

	it('can switch to a richer redactor (e.g. the session one) and keeps masking', () => {
		const { printer, out } = capture();
		const next = createRedactor({ sensitiveValues: ['s3cret-token'] });
		printer.useRedactor(next);
		expect(printer.redactor).toBe(next);
		printer.line('token s3cret-token for teller01');
		expect(out()).not.toContain('s3cret-token');
		expect(out()).not.toContain('teller01');
	});
});

describe('exitCodeFor', () => {
	it('maps success → 0, business_outcome → 3, failure → 1', () => {
		expect(exitCodeFor(SUCCESS)).toBe(EXIT.success);
		expect(exitCodeFor(OUTCOME)).toBe(EXIT.businessOutcome);
		expect(exitCodeFor(FAILURE)).toBe(EXIT.failure);
		expect(EXIT).toEqual({ success: 0, failure: 1, businessOutcome: 3, discoveryStopped: 4, usage: 64 });
	});
});
