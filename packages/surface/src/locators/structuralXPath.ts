import type { LocatorRung } from '@idp/artifact-schema';
import { substituteTemplate } from '../internal/substituteTemplate.js';
import type { Bindings } from '../port/Bindings.js';

/** The anchor of a structural rung. */
export type StructuralAnchor = Extract<LocatorRung, { kind: 'structural' }>['anchor'];

/** Normalized text of the context node; legacy pages pad cells with &nbsp;, which normalize-space keeps. */
const NORM = "normalize-space(translate(., ' ', ' '))";
const CELL = '(self::td or self::th)';
const LOWER = "translate(@type, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')";
const typeIn = (types: string) => `contains(' ${types} ', concat(' ', ${LOWER}, ' '))`;

/** Element predicates (for use inside `*[…]`) per structural element kind. */
const ELEMENT: Record<'input' | 'select' | 'button' | 'link' | 'cell' | 'row', string> = {
	input: `self::textarea or self::input[not(@type) or not(${typeIn('submit button image reset hidden')})]`,
	select: 'self::select',
	button: `self::button or self::input[${typeIn('submit button image reset')}]`,
	link: 'self::a[@href]',
	cell: CELL,
	row: 'self::tr',
};
const CONTAINER = '(self::form or self::table or self::tr)';

/**
 * An XPath 1.0 string literal for any text. XPath has no escapes, so text with both quote kinds becomes
 * `concat("…", '"', "…")`.
 */
export function xpathLiteral(text: string): string {
	if (!text.includes('"')) return `"${text}"`;
	if (!text.includes("'")) return `'${text}'`;
	const parts: string[] = [];
	text.split('"').forEach((part, index) => {
		if (index > 0) parts.push(`'"'`);
		if (part !== '') parts.push(`"${part}"`);
	});
	return `concat(${parts.join(', ')})`;
}

/** Predicate: the context cell's normalized text is the label (a trailing colon is tolerated). */
const labelPredicate = (text: string) => `${NORM}=${xpathLiteral(text)} or ${NORM}=${xpathLiteral(`${text}:`)}`;

/**
 * The frame-scoped XPath for a structural anchor, with `{{placeholders}}` substituted from `bindings`.
 *
 * - `table_cell_relative` right: the `offset`-th cell after the cell whose text is the header.
 * - `table_cell_relative` below: the cell in the same column position, `offset` rows further down
 *   (column position counts preceding cells; colspan is not modelled).
 * - `form_row`: the control in the cells following the label cell in the same row, or inside the label cell.
 * - `nth_in_container`: the `index`-th element of the kind inside the innermost form/table/row whose text
 *   contains `containerText` and which holds enough such elements; without text, in the whole document.
 */
export function structuralXPath(anchor: StructuralAnchor, bindings: Bindings): string {
	switch (anchor.kind) {
		case 'table_cell_relative': {
			const header = labelPredicate(substituteTemplate(anchor.headerText, bindings));
			if (anchor.direction === 'right') {
				return `//*[${CELL}][${header}]/following-sibling::*[${CELL}][${anchor.offset}]`;
			}
			const anchorCell = `preceding-sibling::tr[${anchor.offset}]/*[${CELL}][${header}]`;
			return (
				`//tr[${anchorCell}]/*[${CELL}]` +
				`[count(preceding-sibling::*[${CELL}]) = count(../${anchorCell}/preceding-sibling::*[${CELL}])]`
			);
		}
		case 'form_row': {
			const labelCell = `//*[${CELL}][${labelPredicate(substituteTemplate(anchor.labelText, bindings))}]`;
			const control = ELEMENT[anchor.control];
			return `(${labelCell}/following-sibling::*[${CELL}]/descendant::*[${control}] | ${labelCell}/descendant::*[${control}])`;
		}
		case 'nth_in_container': {
			const element = ELEMENT[anchor.element];
			if (anchor.containerText === undefined) return `(//*[${element}])[${anchor.index + 1}]`;
			const text = xpathLiteral(substituteTemplate(anchor.containerText, bindings));
			const candidate = `${CONTAINER} and contains(${NORM}, ${text}) and count(descendant::*[${element}]) > ${anchor.index}`;
			return `//*[${candidate} and not(descendant::*[${candidate}])]/descendant::*[${element}][${anchor.index + 1}]`;
		}
	}
}
