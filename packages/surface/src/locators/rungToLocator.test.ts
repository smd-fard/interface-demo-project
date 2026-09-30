import type { LocatorRung } from '@idp/artifact-schema';
import { describe, expect, it } from 'vitest';
import { BindingMissingError } from '../errors/BindingMissingError.js';
import { rungToLocator, type LocatorFactory } from './rungToLocator.js';
import { structuralXPath } from './structuralXPath.js';

/** Records the Playwright call a rung turns into, instead of querying a page. */
function fakeFrame() {
	const calls: unknown[][] = [];
	const record =
		(method: string) =>
		(...args: unknown[]) => {
			calls.push([method, ...args]);
			return { method, args };
		};
	const frame = {
		getByRole: record('getByRole'),
		getByLabel: record('getByLabel'),
		getByText: record('getByText'),
		locator: record('locator'),
	} as unknown as LocatorFactory;
	return { frame, calls };
}
const rationale = 'test';

describe('rungToLocator', () => {
	it('role → getByRole with the template name substituted and exact passed through', () => {
		const { frame, calls } = fakeFrame();
		rungToLocator(
			frame,
			{ kind: 'role', role: 'link', name: 'Member {{memberId}}', exact: true, rationale },
			{
				memberId: '12345',
			},
		);
		expect(calls).toEqual([['getByRole', 'link', { name: 'Member 12345', exact: true }]]);
	});

	it('role without a name → getByRole(role); exact defaults to false', () => {
		const { frame, calls } = fakeFrame();
		rungToLocator(frame, { kind: 'role', role: 'heading', rationale }, {});
		rungToLocator(frame, { kind: 'role', role: 'button', name: 'Search', rationale }, {});
		expect(calls).toEqual([
			['getByRole', 'heading', {}],
			['getByRole', 'button', { name: 'Search', exact: false }],
		]);
	});

	it('label → getByLabel; text → getByText with exact for match "exact"', () => {
		const { frame, calls } = fakeFrame();
		rungToLocator(frame, { kind: 'label', text: 'Member Number', rationale }, {});
		rungToLocator(frame, { kind: 'text', text: 'Search', match: 'exact', rationale }, {});
		rungToLocator(frame, { kind: 'text', text: 'Savings', match: 'contains', rationale }, {});
		expect(calls).toEqual([
			['getByLabel', 'Member Number'],
			['getByText', 'Search', { exact: true }],
			['getByText', 'Savings', { exact: false }],
		]);
	});

	it('structural → a frame-scoped xpath locator from the pure builder', () => {
		const { frame, calls } = fakeFrame();
		const rung: LocatorRung = {
			kind: 'structural',
			anchor: { kind: 'form_row', labelText: 'Member #', control: 'input' },
			rationale,
			surface: { web: { cssHint: 'input[name=txt1]' } },
		};
		rungToLocator(frame, rung, {});
		expect(calls).toEqual([
			['locator', `xpath=${structuralXPath({ kind: 'form_row', labelText: 'Member #', control: 'input' }, {})}`],
		]);
	});

	it('never uses the cssHint', () => {
		const { frame, calls } = fakeFrame();
		rungToLocator(frame, { kind: 'label', text: 'X', rationale, surface: { web: { cssHint: '#x' } } }, {});
		expect(JSON.stringify(calls)).not.toContain('#x');
	});

	it('throws BindingMissingError for an unbound placeholder', () => {
		const { frame } = fakeFrame();
		expect(() => rungToLocator(frame, { kind: 'label', text: '{{memberId}}', rationale }, {})).toThrow(
			BindingMissingError,
		);
	});
});
