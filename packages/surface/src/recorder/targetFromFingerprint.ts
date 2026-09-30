import type { LocatorRung, TargetRef } from '@idp/artifact-schema';
import type { ElementFingerprint } from '../port/ElementFingerprint.js';

const rationale = 'recorded from a human gesture during a handoff';
const ROLE = /^[a-z]+$/;
const FORM_ROW_CONTROLS = new Set(['input', 'select', 'button']);

/**
 * A locator ladder for a recorded element, in stability order: role + exact accessible name, the form row
 * labelled by the adjacent cell, then (last resort) the position in its container; exact visible text when
 * nothing else identifies it. The recorder re-executes the gesture through it (and checks it resolves the
 * very element the human touched). `null` when nothing identifies the element. Pure.
 */
export function targetFromFingerprint(fingerprint: ElementFingerprint): TargetRef | null {
	const ladder: LocatorRung[] = [];
	if (fingerprint.role !== null && ROLE.test(fingerprint.role) && fingerprint.name !== '') {
		ladder.push({ kind: 'role', role: fingerprint.role, name: fingerprint.name, exact: true, rationale });
	}
	const container = fingerprint.container;
	if (fingerprint.labelCellText !== null && container !== null && FORM_ROW_CONTROLS.has(container.element)) {
		ladder.push({
			kind: 'structural',
			anchor: {
				kind: 'form_row',
				labelText: fingerprint.labelCellText,
				control: container.element as 'input' | 'select' | 'button',
			},
			rationale,
		});
	}
	if (container !== null) {
		ladder.push({
			kind: 'structural',
			anchor: {
				kind: 'nth_in_container',
				...(container.containerText === null ? {} : { containerText: container.containerText }),
				element: container.element,
				index: container.index,
			},
			rationale,
		});
	}
	if (ladder.length === 0 && fingerprint.visibleText !== '') {
		ladder.push({ kind: 'text', text: fingerprint.visibleText, match: 'exact', rationale });
	}
	if (ladder.length === 0) return null;
	const label = fingerprint.name || fingerprint.labelCellText || fingerprint.visibleText || fingerprint.tag;
	return {
		description: `${fingerprint.role ?? fingerprint.tag} "${label}" (recorded)`.slice(0, 300),
		frame: [...fingerprint.frameScope],
		ladder: ladder.slice(0, 5),
	};
}
