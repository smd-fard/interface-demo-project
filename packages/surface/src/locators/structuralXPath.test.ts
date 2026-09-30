import { describe, expect, it } from 'vitest';
import { structuralXPath, xpathLiteral } from './structuralXPath.js';

const NORM = "normalize-space(translate(., ' ', ' '))";
const CELL = '(self::td or self::th)';
const label = (text: string) => `${NORM}=${xpathLiteral(text)} or ${NORM}=${xpathLiteral(`${text}:`)}`;

describe('xpathLiteral', () => {
	it('quotes plain text with double quotes', () => {
		expect(xpathLiteral('Member #')).toBe('"Member #"');
	});
	it('uses single quotes when the text holds a double quote', () => {
		expect(xpathLiteral('Say "hi"')).toBe(`'Say "hi"'`);
	});
	it('uses concat() when the text holds both quote kinds', () => {
		expect(xpathLiteral(`It's "x"`)).toBe(`concat("It's ", '"', "x", '"')`);
	});
	it('handles a lone double quote', () => {
		expect(xpathLiteral(`'"`)).toBe(`concat("'", '"')`);
	});
});

describe('structuralXPath', () => {
	it('table_cell_relative right: the Nth following sibling cell of the header cell', () => {
		expect(
			structuralXPath({ kind: 'table_cell_relative', headerText: 'Share Savings', direction: 'right', offset: 1 }, {}),
		).toBe(`//*[${CELL}][${label('Share Savings')}]/following-sibling::*[${CELL}][1]`);
	});

	it('table_cell_relative below: the cell in the same column, N rows further down', () => {
		expect(
			structuralXPath({ kind: 'table_cell_relative', headerText: 'Balance', direction: 'below', offset: 2 }, {}),
		).toBe(
			`//tr[preceding-sibling::tr[2]/*[${CELL}][${label('Balance')}]]/*[${CELL}]` +
				`[count(preceding-sibling::*[${CELL}]) = count(../preceding-sibling::tr[2]/*[${CELL}][${label('Balance')}]/preceding-sibling::*[${CELL}])]`,
		);
	});

	it('form_row input: a text-like input in the cells after the label cell (or inside it)', () => {
		const xpath = structuralXPath({ kind: 'form_row', labelText: 'Member #', control: 'input' }, {});
		const labelCell = `//*[${CELL}][${label('Member #')}]`;
		expect(xpath.startsWith(`(${labelCell}/following-sibling::*[${CELL}]/descendant::*[`)).toBe(true);
		expect(xpath).toContain(` | ${labelCell}/descendant::*[`);
		expect(xpath).toContain('self::textarea');
		expect(xpath).toContain("' submit button image reset hidden '");
	});

	it('form_row button: a <button> or a submit/button/image/reset input', () => {
		const xpath = structuralXPath({ kind: 'form_row', labelText: 'Product', control: 'button' }, {});
		expect(xpath).toContain('self::button');
		expect(xpath).toContain("' submit button image reset '");
		expect(structuralXPath({ kind: 'form_row', labelText: 'Product', control: 'select' }, {})).toContain(
			'self::select',
		);
	});

	it('nth_in_container with text: the innermost form/table/row holding the text and enough elements', () => {
		const xpath = structuralXPath(
			{ kind: 'nth_in_container', containerText: 'Sign On', element: 'input', index: 1 },
			{},
		);
		expect(xpath).toMatch(/^\/\/\*\[\(self::form or self::table or self::tr\) and contains\(/);
		expect(xpath).toContain('count(descendant::*[');
		expect(xpath).toContain('> 1 and not(descendant::*[');
		expect(xpath.endsWith('][2]')).toBe(true);
	});

	it('nth_in_container without text: the Nth element in the document', () => {
		expect(structuralXPath({ kind: 'nth_in_container', element: 'cell', index: 0 }, {})).toBe(`(//*[${CELL}])[1]`);
		expect(structuralXPath({ kind: 'nth_in_container', element: 'link', index: 3 }, {})).toBe(
			'(//*[self::a[@href]])[4]',
		);
		expect(structuralXPath({ kind: 'nth_in_container', element: 'row', index: 0 }, {})).toBe('(//*[self::tr])[1]');
	});

	it('substitutes bindings into the anchor text and escapes quotes safely', () => {
		expect(
			structuralXPath(
				{ kind: 'table_cell_relative', headerText: 'Acct {{acct}}', direction: 'right', offset: 1 },
				{
					acct: `O'Neil "7"`,
				},
			),
		).toContain(`concat("Acct O'Neil ", '"', "7", '"')`);
	});
});
