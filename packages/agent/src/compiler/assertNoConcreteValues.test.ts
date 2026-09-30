import { readFile } from 'node:fs/promises';
import { CapabilityArtifactSchema, type CapabilityArtifact } from '@idp/artifact-schema';
import { DEFAULT_REDACTION_CONFIG } from '@idp/policy';
import { beforeAll, describe, expect, it } from 'vitest';
import { ConcreteValueLeakError } from '../errors/ConcreteValueLeakError.js';
import { assertNoConcreteValues } from './assertNoConcreteValues.js';

const values = {
	exampleInputs: ['12345'],
	credentials: ['teller01', 'synthetic-pass-01'],
	extracted: ['1523.47', 'Jane Sample'],
};

let golden: CapabilityArtifact;
beforeAll(async () => {
	const url = new URL('../../../artifact-schema/fixtures/member-lookup.artifact.json', import.meta.url);
	golden = CapabilityArtifactSchema.parse(JSON.parse(await readFile(url, 'utf8')));
});

function leak(error: unknown): ConcreteValueLeakError {
	expect(error).toBeInstanceOf(ConcreteValueLeakError);
	return error as ConcreteValueLeakError;
}

describe('assertNoConcreteValues', () => {
	it('accepts the golden member-lookup artifact (references only)', () => {
		expect(() => assertNoConcreteValues(golden, values)).not.toThrow();
	});

	it('finds an example input anywhere and names the path, never the value', () => {
		const leaky = structuredClone(golden);
		const step = leaky.steps[5];
		if (step === undefined) throw new Error('fixture');
		leaky.steps[5] = { ...step, description: 'Search for member 12345' };
		let caught: unknown;
		try {
			assertNoConcreteValues(leaky, values);
		} catch (error) {
			caught = error;
		}
		const error = leak(caught);
		expect(error.path).toBe('steps[5].description');
		expect(error.valueKind).toBe('example input');
		expect(error.message).not.toContain('12345');
	});

	it('finds credentials and extracted values, case-insensitively', () => {
		for (const [text, kind] of [
			['user TELLER01', 'credential'],
			['balance 1523.47', 'extracted value'],
			['for jane sample', 'extracted value'],
		] as const) {
			const leaky = { ...structuredClone(golden), title: text };
			expect(() => assertNoConcreteValues(leaky, values)).toThrow(ConcreteValueLeakError);
			try {
				assertNoConcreteValues(leaky, values);
			} catch (error) {
				expect(leak(error).valueKind).toBe(kind);
			}
		}
	});

	it('matches a digit value only at digit boundaries and ignores values shorter than 2 characters', () => {
		const other = { ...structuredClone(golden), title: 'Account 8800123450' };
		expect(() => assertNoConcreteValues(other, values)).not.toThrow();
		expect(() => assertNoConcreteValues(golden, { ...values, exampleInputs: ['s'] })).not.toThrow();
	});

	it('does not scan the content hash (hex, carries no data)', () => {
		const hashed = { ...structuredClone(golden), contentHash: `sha256:12345${'0'.repeat(59)}` };
		expect(() => assertNoConcreteValues(hashed, values)).not.toThrow();
	});

	it('skips the caller-declared param types (an enum lists its values) but scans the rest of each param', () => {
		const withEnum = structuredClone(golden);
		withEnum.params.push({
			name: 'product',
			description: 'The sub-account product to open.',
			type: { kind: 'enum', values: ['Holiday Club', 'Vacation Savings'] },
			required: true,
			sensitive: false,
		});
		const product = { ...values, exampleInputs: ['12345', 'Holiday Club'] };
		expect(() => assertNoConcreteValues(withEnum, product)).not.toThrow();
		const described = structuredClone(withEnum);
		const param = described.params[1];
		if (param === undefined) throw new Error('fixture');
		described.params[1] = { ...param, description: 'e.g. Holiday Club' };
		expect(() => assertNoConcreteValues(described, product)).toThrow(ConcreteValueLeakError);
	});

	it('scans object keys too', () => {
		const leaky = structuredClone(golden) as unknown as Record<string, unknown>;
		leaky['12345'] = true;
		expect(() => assertNoConcreteValues(leaky as unknown as CapabilityArtifact, values)).toThrow(
			ConcreteValueLeakError,
		);
	});

	describe('with the redaction rules (patterns and terms)', () => {
		const none = { exampleInputs: [], credentials: [], extracted: [] };
		const rules = { redaction: DEFAULT_REDACTION_CONFIG };

		it('accepts the golden member-lookup and open-sub-account artifacts', async () => {
			const url = new URL('../../../artifact-schema/fixtures/open-sub-account.artifact.json', import.meta.url);
			const open = CapabilityArtifactSchema.parse(JSON.parse(await readFile(url, 'utf8')));
			expect(() => assertNoConcreteValues(golden, none, rules)).not.toThrow();
			expect(() => assertNoConcreteValues(open, none, rules)).not.toThrow();
		});

		it.each([
			['a member-number-like literal', '24680'],
			['an SSN-like literal', '900-12-3456'],
			['an account number', '8800123450'],
			['a configured term', 'Jane Sample'],
		])('finds %s in a description and names the path only', (_, value) => {
			const leaky = structuredClone(golden);
			const step = leaky.steps[5];
			if (step === undefined) throw new Error('fixture');
			leaky.steps[5] = { ...step, description: `Search for ${value}.` };
			let caught: unknown;
			try {
				assertNoConcreteValues(leaky, none, rules);
			} catch (error) {
				caught = error;
			}
			const error = leak(caught);
			expect(error.path).toBe('steps[5].description');
			expect(error.valueKind).toBe('value matching a redaction rule');
			expect(error.message).not.toContain(value);
		});

		it('finds a sensitive value in a literal ValueExpr, the summary and checkpoint text', () => {
			const inSummary = structuredClone(golden);
			inSummary.summary = { ...inSummary.summary, does: 'Looks up 900-12-3456.' };
			expect(() => assertNoConcreteValues(inSummary, none, rules)).toThrow(/summary\.does/);
			const inTitle = { ...structuredClone(golden), title: 'For jane sample' };
			expect(() => assertNoConcreteValues(inTitle, none, rules)).toThrow(/at title;/);
		});

		it('does not scan structural fields: the content hash, ids, versions, provenance, param and output types', () => {
			const structural = structuredClone(golden);
			structural.contentHash = `sha256:12345${'0'.repeat(59)}`;
			structural.provenance = { ...structural.provenance, discoveryRunId: 'discovery-20260929T101500-a1b2' };
			const step = structural.steps[0];
			if (step === undefined) throw new Error('fixture');
			structural.steps[0] = { ...step, id: 's01-open-12345' };
			structural.params.push({
				name: 'branch',
				description: 'The branch code.',
				type: { kind: 'enum', values: ['10001', '10002'] },
				required: true,
				sensitive: false,
			});
			expect(() => assertNoConcreteValues(structural, none, rules)).not.toThrow();
		});

		// Expectation changed with redaction rules 1.1.0: a decimal amount used to pass the rule scan. Money amounts
		// are now masked by the money-amount rule, so a concrete amount in free text is a leak; a placeholder is not.
		it('finds a decimal amount in free text but keeps a placeholder', () => {
			const amounts = { ...structuredClone(golden), title: 'Deposit 12345.67 for {{memberId}}' };
			expect(() => assertNoConcreteValues(amounts, none, rules)).toThrow(/at title;/);
			const placeholder = { ...structuredClone(golden), title: 'Deposit {{initialDeposit}} for {{memberId}}' };
			expect(() => assertNoConcreteValues(placeholder, none, rules)).not.toThrow();
		});

		function withAmountParam(sensitive: boolean): CapabilityArtifact {
			const artifact = structuredClone(golden);
			artifact.params.push({
				name: 'initialDeposit',
				description: 'The opening deposit amount.',
				type: { kind: 'decimal', scale: 2 },
				required: true,
				sensitive,
				example: '250.00',
			});
			return artifact;
		}

		it('skips the rules on the declared example of a NON-sensitive param (e.g. a deposit amount)', () => {
			expect(() => assertNoConcreteValues(withAmountParam(false), none, rules)).not.toThrow();
		});

		it('still applies the rules to the example of a sensitive param', () => {
			expect(() => assertNoConcreteValues(withAmountParam(true), none, rules)).toThrow(/params\[1\]\.example/);
		});

		it('still finds a literal amount in a step value (an amount must be a param reference)', () => {
			const leaky = structuredClone(golden);
			const index = leaky.steps.findIndex((step) => step.kind === 'fill');
			const step = leaky.steps[index];
			if (step?.kind !== 'fill') throw new Error('fixture');
			leaky.steps[index] = { ...step, sensitive: false, value: { kind: 'literal', value: '250.00' } };
			expect(() => assertNoConcreteValues(leaky, none, rules)).toThrow(
				new RegExp(`steps\\[${index}\\]\\.value\\.value`),
			);
		});
	});
});
