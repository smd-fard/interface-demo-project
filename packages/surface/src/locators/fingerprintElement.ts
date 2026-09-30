import type { Frame, Locator } from 'playwright';
import type { ContainerElementKind, ElementFingerprint } from '../port/ElementFingerprint.js';
import { parseAriaSnapshot } from '../snapshot/a11ySnapshot.js';
import { framePathOf, frameScopeOf } from './FrameResolver.js';

type DomFacts = Omit<ElementFingerprint, 'role' | 'name' | 'framePath' | 'frameScope'>;

/** Runs in the page: layout facts about one element. Self-contained (it is serialized into the frame). */
const domFacts = (el: Element): DomFacts => {
	const norm = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
	const cellText = (cell: Element | null | undefined) => (cell ? norm((cell as HTMLElement).innerText) : '');
	const tag = el.tagName.toLowerCase();
	const type = tag === 'input' ? (el.getAttribute('type') ?? 'text').toLowerCase() : null;
	const buttonTypes = ['submit', 'button', 'image', 'reset'];
	let kind: ContainerElementKind | null = null;
	if (tag === 'select') kind = 'select';
	else if (tag === 'button' || (type !== null && buttonTypes.includes(type))) kind = 'button';
	else if (tag === 'textarea' || (type !== null && type !== 'hidden')) kind = 'input';
	else if (tag === 'a' && el.hasAttribute('href')) kind = 'link';
	else if (tag === 'td' || tag === 'th') kind = 'cell';
	else if (tag === 'tr') kind = 'row';

	const cell = el.closest('td, th');
	const row = cell?.parentElement?.tagName === 'TR' ? cell.parentElement : el.closest('tr');
	const cells = row ? [...row.children].filter((child) => child.tagName === 'TD' || child.tagName === 'TH') : [];

	let labelCellText: string | null = null;
	for (let previous = cell?.previousElementSibling; previous; previous = previous.previousElementSibling) {
		if (cellText(previous) !== '') {
			labelCellText = cellText(previous);
			break;
		}
	}
	const header = cells.find((candidate) => cellText(candidate) !== '');
	const rowHeaderText = header && header !== cell ? cellText(header) : null;

	let columnHeaderText: string | null = null;
	const table = row?.closest('table');
	const firstRow = table ? table.querySelector('tr') : null;
	if (cell && firstRow && firstRow !== row) {
		const column = cells.indexOf(cell);
		const headerCells = [...firstRow.children].filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
		const text = cellText(headerCells[column]);
		columnHeaderText = text === '' ? null : text;
	}

	let container: DomFacts['container'] = null;
	if (kind !== null) {
		const scope =
			kind === 'cell'
				? el.closest('tr')
				: kind === 'row'
					? el.closest('table')
					: (el.closest('form') ?? el.closest('table'));
		const selector: Record<ContainerElementKind, string> = {
			input:
				'textarea, input:not([type=submit i]):not([type=button i]):not([type=image i]):not([type=reset i]):not([type=hidden i])',
			select: 'select',
			button: 'button, input[type=submit i], input[type=button i], input[type=image i], input[type=reset i]',
			link: 'a[href]',
			cell: 'td, th',
			row: 'tr',
		};
		const root = scope ?? el.ownerDocument.documentElement;
		const index = [...root.querySelectorAll(selector[kind])].indexOf(el);
		const firstLine = norm(((root as HTMLElement).innerText ?? '').split('\n').find((line) => norm(line) !== ''));
		container = { element: kind, index, containerText: scope && firstLine !== '' ? firstLine.slice(0, 120) : null };
	}

	let navigatesTo: string | null = null;
	if (tag === 'a' && el.hasAttribute('href')) navigatesTo = (el as HTMLAnchorElement).href;
	else {
		const control = el as HTMLButtonElement | HTMLInputElement;
		const form = 'form' in control ? control.form : null;
		if (form) {
			const own = control.getAttribute('formaction');
			navigatesTo = own !== null && 'formAction' in control ? control.formAction : form.action;
		}
	}

	const caption = kind === 'button' && tag === 'input' ? el.getAttribute('value') : (el as HTMLElement).innerText;
	return {
		tag,
		nameAttribute: el.getAttribute('name'),
		inputType: type,
		labelCellText,
		rowHeaderText,
		columnHeaderText,
		container,
		navigatesTo,
		visibleText: norm(tag === 'input' && kind !== 'button' ? '' : caption).slice(0, 200),
	};
};

/**
 * Fingerprints one element for the artifact compiler: role and accessible name from Playwright's aria
 * snapshot of the element, layout facts (label cell, headers, container index) from an in-frame evaluate.
 */
export async function fingerprintElement(frame: Frame, locator: Locator): Promise<ElementFingerprint> {
	const [aria, facts] = await Promise.all([locator.ariaSnapshot(), locator.evaluate(domFacts)]);
	const node = parseAriaSnapshot(aria).children[0];
	const semantic = node !== undefined && node.role !== 'text' ? node : undefined;
	return {
		role: semantic?.role ?? null,
		name: semantic?.name ?? '',
		...facts,
		framePath: framePathOf(frame),
		frameScope: frameScopeOf(frame),
	};
}
