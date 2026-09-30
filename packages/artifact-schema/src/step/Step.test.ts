import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ACTION_KINDS, ActionKindSchema, SCREEN_CHANGING_KINDS } from './ActionKind.js';
import { StepSchema } from './Step.js';

const content = [{ kind: 'by_name', name: 'content' }];

const button = {
	description: 'Search button in the member search form',
	frame: content,
	ladder: [
		{ kind: 'role', role: 'button', name: 'Search', exact: true, rationale: 'Submit input value is its name.' },
		{ kind: 'text', text: 'Search', match: 'exact', rationale: 'Visible button caption.' },
	],
};

const input = {
	description: 'Member # input in the member search form',
	frame: content,
	ladder: [
		{
			kind: 'structural',
			anchor: { kind: 'form_row', labelText: 'Member #', control: 'input' },
			rationale: 'Label lives in the adjacent cell; the input has no accessible name.',
		},
	],
};

const checkpoint = { kind: 'text_present', text: 'Member Inquiry', frame: content };
const base = (id: string, kind: string) => ({ id, kind, description: `Step ${id}`, phase: 'main', risk: 'read' });

const valid = [
	{ ...base('s01-open-app', 'navigate'), phase: 'login', route: '/', checkpoint },
	{ ...base('s02-click-search', 'click'), target: button, checkpoint, timeoutMs: 10_000 },
	{
		...base('s03-fill-member-id', 'fill'),
		risk: 'reversible',
		target: input,
		value: { kind: 'param', name: 'memberId' },
		sensitive: true,
	},
	{
		...base('s04-fill-user', 'fill'),
		phase: 'login',
		target: input,
		value: { kind: 'credential', ref: 'mockbank-operator', field: 'username' },
		sensitive: true,
	},
	{
		...base('s05-fill-branch', 'fill'),
		target: input,
		value: { kind: 'literal', value: 'MAIN' },
		sensitive: false,
	},
	{
		...base('s06-select-product', 'select'),
		risk: 'reversible',
		target: input,
		option: { kind: 'param', name: 'product' },
		checkpoint,
	},
	{ ...base('s07-press-enter', 'press'), key: 'Enter', checkpoint },
	{ ...base('s08-press-tab', 'press'), target: input, key: 'Tab', checkpoint },
	{
		...base('s09-extract-balance', 'extract'),
		target: input,
		output: 'savingsBalance',
		parse: { kind: 'decimal' },
	},
	{
		...base('s10-extract-confirmation', 'extract'),
		target: input,
		output: 'confirmationNumber',
		parse: { kind: 'text', pattern: 'SA-\\d{6}' },
	},
	{ ...base('s11-extract-count', 'extract'), target: input, output: 'count', parse: { kind: 'integer' } },
	{ ...base('s12-wait-detail', 'wait'), until: checkpoint, timeoutMs: 20_000 },
	{
		...base('s13-dismiss-notice', 'dismiss_dialog'),
		match: 'Scheduled maintenance',
		action: 'accept',
		checkpoint,
	},
];

describe('ActionKind', () => {
	it('lists the eight action kinds, and the screen-changing ones are a subset', () => {
		expect(ACTION_KINDS).toEqual(['navigate', 'click', 'fill', 'select', 'press', 'extract', 'wait', 'dismiss_dialog']);
		expect([...SCREEN_CHANGING_KINDS].sort()).toEqual(['click', 'dismiss_dialog', 'navigate', 'press', 'select']);
		for (const kind of SCREEN_CHANGING_KINDS) expect(ActionKindSchema.parse(kind)).toBe(kind);
		expect(ActionKindSchema.safeParse('hover').success).toBe(false);
	});
});

describe('StepSchema', () => {
	it.each(valid)('accepts $kind ($id)', (step) => {
		expect(StepSchema.parse(step)).toEqual(step);
	});

	it('covers every action kind in the valid fixtures', () => {
		expect(new Set(valid.map((step) => step.kind))).toEqual(new Set(ACTION_KINDS));
	});

	it.each(['navigate', 'click', 'press', 'select', 'dismiss_dialog'])(
		'rejects a screen-changing %s step without a checkpoint (invariant 5)',
		(kind) => {
			const step: Record<string, unknown> = { ...valid.find((s) => s.kind === kind) };
			delete step.checkpoint;
			const result = StepSchema.safeParse(step);
			expect(result.success).toBe(false);
			expect(result.error?.issues[0]?.path).toEqual(['checkpoint']);
		},
	);

	it('rejects a fill with a literal value marked sensitive (a raw secret/PII in the artifact)', () => {
		const result = StepSchema.safeParse({
			...base('s03-fill-member-id', 'fill'),
			target: input,
			value: { kind: 'literal', value: '12345' },
			sensitive: true,
		});
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['value']);
	});

	it('rejects a credential fill that is not marked sensitive', () => {
		const result = StepSchema.safeParse({ ...valid[3], sensitive: false });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['sensitive']);
	});

	it('rejects a credential as a select option', () => {
		const result = StepSchema.safeParse({
			...valid[5],
			option: { kind: 'credential', ref: 'mockbank-operator', field: 'password' },
		});
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['option']);
	});

	it('rejects a raw value inside a credential reference (strict)', () => {
		const result = StepSchema.safeParse({
			...valid[3],
			value: { kind: 'credential', ref: 'mockbank-operator', field: 'password', value: 'hunter2' },
		});
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path.slice(0, 1)).toEqual(['value']);
	});

	it('rejects an unknown extra key (strict)', () => {
		expect(StepSchema.safeParse({ ...valid[1], selector: '#btnGo' }).success).toBe(false);
	});

	it('rejects an unknown kind, a bad step id and a missing required field', () => {
		expect(StepSchema.safeParse({ ...valid[1], kind: 'hover' }).success).toBe(false);
		expect(StepSchema.safeParse({ ...valid[1], id: 'click-search' }).success).toBe(false);
		const noRisk: Record<string, unknown> = { ...valid[1] };
		delete noRisk.risk;
		const result = StepSchema.safeParse(noRisk);
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['risk']);
	});

	it('rejects a key outside the allowlist, a non-relative route and a wait without timeout', () => {
		expect(StepSchema.safeParse({ ...valid[6], key: 'Delete' }).success).toBe(false);
		expect(StepSchema.safeParse({ ...valid[0], route: 'https://bank.example/' }).success).toBe(false);
		const wait: Record<string, unknown> = { ...valid[11] };
		delete wait.timeoutMs;
		expect(StepSchema.safeParse(wait).success).toBe(false);
	});

	it('rejects an invalid parse pattern and an unknown parse kind', () => {
		expect(StepSchema.safeParse({ ...valid[9], parse: { kind: 'text', pattern: '(' } }).success).toBe(false);
		expect(StepSchema.safeParse({ ...valid[9], parse: { kind: 'date' } }).success).toBe(false);
	});

	it('exports to JSON Schema', () => {
		expect(() => z.toJSONSchema(StepSchema)).not.toThrow();
	});
});
