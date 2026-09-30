import type { LocatorRung, TargetRef } from '@idp/artifact-schema';
import type { ElementFingerprint } from '@idp/surface';
import { UnlocatableTargetError } from '../errors/UnlocatableTargetError.js';
import type { TextGuard } from './TextGuard.js';

/** Options of `buildLocatorLadder`: why the element is located, and the guard for locator text. */
export interface BuildLocatorLadderOptions {
	/** `extract`: the element's own text is the data being read, so it is never used to find it. */
	readonly purpose: 'act' | 'extract' | 'check';
	/** Accepts only text that may be written into the artifact (no values, masks or braces). */
	readonly guard: TextGuard;
}

const ROLE = /^[a-z]+$/;
const DATA_ROLES = new Set(['cell', 'gridcell', 'row', 'rowheader', 'columnheader']);
const CLICKABLE_ROLES = new Set(['button', 'link', 'tab', 'menuitem', 'checkbox', 'radio']);
const FORM_ROW_CONTROLS = new Set(['input', 'select', 'button']);
const CSS_NAME = /^[A-Za-z][\w-]*$/;
const MAX_LADDER = 5;

type Rung = LocatorRung;

function cssHint(fingerprint: ElementFingerprint): Rung['surface'] {
	const name = fingerprint.nameAttribute;
	if (name === null || !CSS_NAME.test(name) || !CSS_NAME.test(fingerprint.tag)) return undefined;
	return { web: { cssHint: `${fingerprint.tag}[name=${name}]` } };
}

function isCell(fingerprint: ElementFingerprint): boolean {
	return (
		(fingerprint.role !== null && DATA_ROLES.has(fingerprint.role)) ||
		fingerprint.tag === 'td' ||
		fingerprint.tag === 'th' ||
		fingerprint.container?.element === 'cell'
	);
}

/**
 * Builds the locator ladder (FR8) of an element from its fingerprint, most stable rung first:
 * 1. role + exact accessible name — when the name is non-empty, safe (not a param value, not masked) and not
 *    the data being read (an extracted element, a table cell);
 * 2. the exact visible text — for clickables (a submit input's caption);
 * 3. a structural anchor — the cell right of its row-label cell (extracted cells); the control in the form row
 *    of its adjacent label cell (unnamed legacy inputs); and, as the last resort, its position in its
 *    container, scoped by the row header (cells) or the container's first text line.
 * Each rung carries a templated rationale; the frame scope is the fingerprint's. A column-header anchor is not
 * emitted: the fingerprint does not record how many rows separate the cell from its header. Throws
 * `UnlocatableTargetError` when no rung is possible. Pure.
 */
export function buildLocatorLadder(fingerprint: ElementFingerprint, options: BuildLocatorLadderOptions): TargetRef {
	const { guard, purpose } = options;
	const role = fingerprint.role;
	const cell = isCell(fingerprint);
	const ownTextUsable = purpose !== 'extract' && !cell;
	const hint = cssHint(fingerprint);
	const ladder: Rung[] = [];
	const push = (rung: Rung) => {
		ladder.push(ladder.length === 0 && hint !== undefined ? { ...rung, surface: hint } : rung);
	};

	const name = fingerprint.name.trim();
	if (ownTextUsable && role !== null && ROLE.test(role) && name !== '' && guard(name)) {
		push({
			kind: 'role',
			role,
			name,
			exact: true,
			rationale: `The ${role} is exposed in the accessibility tree with the accessible name "${name}", the most stable signal a legacy screen offers. Breaks only if the ${role} is renamed or loses its role.`,
		});
	}

	const text = fingerprint.visibleText.trim();
	const clickable = (role !== null && CLICKABLE_ROLES.has(role)) || fingerprint.container?.element === 'button';
	if (ownTextUsable && clickable && text !== '' && guard(text)) {
		push({
			kind: 'text',
			text,
			match: 'exact',
			rationale: `The element's visible caption is "${text}"; an exact match avoids longer texts that contain it. Survives a lost accessibility role; breaks if the caption changes.`,
		});
	}

	const label = fingerprint.labelCellText?.trim() ?? '';
	const container = fingerprint.container;
	if (cell && label !== '' && guard(label)) {
		push({
			kind: 'structural',
			anchor: { kind: 'table_cell_relative', headerText: label, direction: 'right', offset: 1 },
			rationale: `The value sits in the cell right of the label cell "${label}" in a layout table with no ids or labels; the label text is stable. Breaks if the table is pivoted or a column is inserted between them.`,
		});
	} else if (
		!cell &&
		label !== '' &&
		guard(label) &&
		container !== null &&
		FORM_ROW_CONTROLS.has(container.element) &&
		(name === '' || container.element !== 'button')
	) {
		push({
			kind: 'structural',
			anchor: { kind: 'form_row', labelText: label, control: container.element as 'input' | 'select' | 'button' },
			rationale: `The control has no accessible name: its label "${label}" sits in the adjacent table cell (no <label for>, no id, no ARIA), so role and label rungs cannot find it. Breaks if the row is relabelled.`,
		});
	}

	if (container !== null) {
		const rowHeader = fingerprint.rowHeaderText?.trim() ?? '';
		const firstLine = container.containerText?.trim() ?? '';
		const scope = cell && rowHeader !== '' && guard(rowHeader) ? rowHeader : guard(firstLine) ? firstLine : undefined;
		push({
			kind: 'structural',
			anchor: {
				kind: 'nth_in_container',
				...(scope === undefined ? {} : { containerText: scope }),
				element: container.element,
				index: container.index,
			},
			rationale: `Last resort: element ${container.index + 1} of its kind (${container.element}) in the ${
				scope === undefined ? 'frame document' : `container holding "${scope}"`
			}. Breaks whenever an element of that kind is added or reordered before it.`,
		});
	}

	if (ladder.length === 0) throw new UnlocatableTargetError(role ?? fingerprint.tag);

	const labelText = ownTextUsable && name !== '' && guard(name) ? name : label !== '' && guard(label) ? label : '';
	const kind = role ?? fingerprint.tag;
	const description =
		labelText === ''
			? `${kind} element`
			: cell && labelText === label
				? `${kind} next to "${label}"`
				: `${kind} "${labelText}"`;
	return {
		description: description.slice(0, 300),
		frame: [...fingerprint.frameScope],
		ladder: ladder.slice(0, MAX_LADDER),
	};
}
