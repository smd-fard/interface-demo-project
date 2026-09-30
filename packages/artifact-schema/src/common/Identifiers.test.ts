import { describe, expect, it } from 'vitest';
import {
	CapabilityIdSchema,
	ContentHashSchema,
	CredentialRefSchema,
	InterventionIdSchema,
	OutcomeCodeSchema,
	OutputNameSchema,
	ParamNameSchema,
	RunIdSchema,
	RunKindSchema,
	StepIdSchema,
} from './Identifiers.js';

function ok(schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown): boolean {
	return schema.safeParse(value).success;
}

describe('CapabilityIdSchema (kebab slug)', () => {
	it('accepts kebab slugs', () => {
		expect(ok(CapabilityIdSchema, 'member-lookup')).toBe(true);
		expect(ok(CapabilityIdSchema, 'open-sub-account2')).toBe(true);
	});
	it.each(['Member-Lookup', 'member_lookup', '-lookup', 'lookup-', 'a--b', '1lookup', ''])('rejects %j', (v) => {
		expect(ok(CapabilityIdSchema, v)).toBe(false);
	});
});

describe('StepIdSchema (s<NN>-<slug>)', () => {
	it('accepts stable step ids', () => {
		expect(ok(StepIdSchema, 's01-open-search')).toBe(true);
		expect(ok(StepIdSchema, 's12-click-search')).toBe(true);
		expect(ok(StepIdSchema, 's100-confirm')).toBe(true);
	});
	it.each(['s1-open', 'step-01', 's01', 's01-Open', 's01_open', '01-open'])('rejects %j', (v) => {
		expect(ok(StepIdSchema, v)).toBe(false);
	});
});

describe('ParamNameSchema / OutputNameSchema (camelCase)', () => {
	it('accepts camelCase', () => {
		expect(ok(ParamNameSchema, 'memberId')).toBe(true);
		expect(ok(OutputNameSchema, 'savingsBalance')).toBe(true);
	});
	it.each(['MemberId', 'member_id', 'member-id', '1member', '{{memberId}}', ''])('rejects %j', (v) => {
		expect(ok(ParamNameSchema, v)).toBe(false);
		expect(ok(OutputNameSchema, v)).toBe(false);
	});
});

describe('OutcomeCodeSchema (snake_case)', () => {
	it('accepts snake_case', () => {
		expect(ok(OutcomeCodeSchema, 'member_not_found')).toBe(true);
		expect(ok(OutcomeCodeSchema, 'timeout')).toBe(true);
	});
	it.each(['MemberNotFound', 'member-not-found', '_x', 'x_', 'a__b'])('rejects %j', (v) => {
		expect(ok(OutcomeCodeSchema, v)).toBe(false);
	});
});

describe('RunIdSchema / RunKindSchema', () => {
	it('accepts <kind>-<yyyymmddThhmmss>-<4hex>', () => {
		expect(ok(RunIdSchema, 'discovery-20260929T101500-a1b2')).toBe(true);
		expect(ok(RunIdSchema, 'replay-20260929T101500-00ff')).toBe(true);
		expect(RunKindSchema.options).toEqual(['discovery', 'replay']);
	});
	it.each([
		'audit-20260929T101500-a1b2',
		'replay-20260929-a1b2',
		'replay-20260929T101500-A1B2',
		'replay-20260929T101500-a1b',
	])('rejects %j', (v) => {
		expect(ok(RunIdSchema, v)).toBe(false);
	});
});

describe('InterventionIdSchema (ir-<yyyymmddThhmmss>-<4hex>)', () => {
	it('accepts ir ids', () => {
		expect(ok(InterventionIdSchema, 'ir-20260929T101500-beef')).toBe(true);
	});
	it.each(['ir-1', 'IR-20260929T101500-beef', 'replay-20260929T101500-beef'])('rejects %j', (v) => {
		expect(ok(InterventionIdSchema, v)).toBe(false);
	});
});

describe('CredentialRefSchema', () => {
	it('accepts a kebab reference, never a secret', () => {
		expect(ok(CredentialRefSchema, 'mockbank-operator')).toBe(true);
		expect(ok(CredentialRefSchema, 'P@ssw0rd!')).toBe(false);
	});
});

describe('ContentHashSchema', () => {
	it('accepts sha256:<64 hex>', () => {
		expect(ok(ContentHashSchema, `sha256:${'a'.repeat(64)}`)).toBe(true);
		expect(ok(ContentHashSchema, `sha256:${'A'.repeat(64)}`)).toBe(false);
		expect(ok(ContentHashSchema, 'a'.repeat(64))).toBe(false);
	});
});
