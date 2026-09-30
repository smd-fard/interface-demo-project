import type { ElementFingerprint } from '@idp/surface';
import { fakeFingerprint } from '@idp/surface/testing';
import { describe, expect, it } from 'vitest';
import { UnlocatableTargetError } from '../errors/UnlocatableTargetError.js';
import { buildLocatorLadder } from './buildLocatorLadder.js';
import { createTextGuard } from './TextGuard.js';

const content = [{ kind: 'by_name' as const, name: 'content' }];
const guard = createTextGuard(['12345', '1523.47', 'Jane Sample']);

const userIdInput: ElementFingerprint = fakeFingerprint({
	role: 'textbox',
	name: '',
	tag: 'input',
	nameAttribute: 'txtUser',
	inputType: 'text',
	labelCellText: 'User ID',
	rowHeaderText: 'User ID',
	container: { element: 'input', index: 0, containerText: 'Sign On' },
	navigatesTo: 'http://bank.test/login',
	visibleText: '',
});
const searchButton: ElementFingerprint = fakeFingerprint({
	role: 'button',
	name: 'Search',
	nameAttribute: 'btnGo',
	columnHeaderText: 'Member Search',
	container: { element: 'button', index: 0, containerText: 'Member Search' },
	visibleText: 'Search',
});
const balanceCell: ElementFingerprint = fakeFingerprint({
	role: 'cell',
	name: '1523.47',
	tag: 'td',
	inputType: null,
	labelCellText: 'Share Savings',
	rowHeaderText: 'Share Savings',
	columnHeaderText: 'Balance',
	container: { element: 'cell', index: 1, containerText: 'Share Savings 1523.47 [•••3450]' },
	visibleText: '1523.47',
});

describe('buildLocatorLadder', () => {
	it('an unnamed legacy input: the form row of its label cell, then its position in the form', () => {
		const target = buildLocatorLadder(userIdInput, { purpose: 'act', guard });
		expect(target.frame).toEqual(content);
		expect(target.description).toBe('textbox "User ID"');
		expect(target.ladder.map((rung) => rung.kind)).toEqual(['structural', 'structural']);
		expect(target.ladder[0]).toMatchObject({
			anchor: { kind: 'form_row', labelText: 'User ID', control: 'input' },
			surface: { web: { cssHint: 'input[name=txtUser]' } },
		});
		expect(target.ladder[1]).toMatchObject({
			anchor: { kind: 'nth_in_container', containerText: 'Sign On', element: 'input', index: 0 },
		});
		for (const rung of target.ladder) expect(rung.rationale.length).toBeGreaterThan(20);
	});

	it('a button: role + exact name, then its exact text, then its position in the container', () => {
		const target = buildLocatorLadder(searchButton, { purpose: 'act', guard });
		expect(target.description).toBe('button "Search"');
		expect(target.ladder).toMatchObject([
			{ kind: 'role', role: 'button', name: 'Search', exact: true },
			{ kind: 'text', text: 'Search', match: 'exact' },
			{
				kind: 'structural',
				anchor: { kind: 'nth_in_container', containerText: 'Member Search', element: 'button', index: 0 },
			},
		]);
	});

	it('an extracted cell never uses its own (data) text: the cell right of its row header, then the row position', () => {
		const target = buildLocatorLadder(balanceCell, { purpose: 'extract', guard });
		expect(target.description).toBe('cell next to "Share Savings"');
		expect(target.ladder).toMatchObject([
			{
				kind: 'structural',
				anchor: { kind: 'table_cell_relative', headerText: 'Share Savings', direction: 'right', offset: 1 },
			},
			{
				kind: 'structural',
				anchor: { kind: 'nth_in_container', containerText: 'Share Savings', element: 'cell', index: 1 },
			},
		]);
		const json = JSON.stringify(target);
		expect(json).not.toContain('1523.47');
		expect(json).not.toContain('•••');
	});

	it('skips a role+name rung whose name holds a param value or a mask', () => {
		const target = buildLocatorLadder(
			fakeFingerprint({
				role: 'link',
				name: 'Member 12345',
				visibleText: 'Member 12345',
				container: { element: 'link', index: 2, containerText: 'Main Menu' },
			}),
			{
				purpose: 'act',
				guard,
			},
		);
		expect(JSON.stringify(target)).not.toContain('12345');
		expect(target.ladder.every((rung) => rung.kind !== 'role')).toBe(true);
	});

	it('throws UnlocatableTargetError when nothing safe identifies the element', () => {
		const fingerprint = fakeFingerprint({
			role: 'cell',
			name: 'Jane Sample',
			visibleText: 'Jane Sample',
			container: null,
		});
		expect(() => buildLocatorLadder(fingerprint, { purpose: 'extract', guard })).toThrow(UnlocatableTargetError);
	});

	it('takes the frame scope from the fingerprint (an unnamed frame by its URL path)', () => {
		const scope = [{ kind: 'by_url_path' as const, glob: '**/inner.html' }];
		const target = buildLocatorLadder(fakeFingerprint({ frameScope: scope }), { purpose: 'act', guard });
		expect(target.frame).toEqual(scope);
	});
});
