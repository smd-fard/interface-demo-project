import { randomUUID } from 'node:crypto';
import type { Redactor } from '@idp/policy';
import type { Frame, Locator, Page } from 'playwright';
import { isGoneFrameError } from '../internal/isGoneFrameError.js';

/**
 * Row headers whose rows hold sensitive values in legacy core-banking screens: every other cell of such a row
 * is masked whole, whatever its text (balances, names, account numbers).
 */
export const DEFAULT_SENSITIVE_ROW_HEADERS: readonly string[] = Object.freeze([
	'Share Savings',
	'Checking',
	'Member Name',
	'SSN',
	'Account',
]);

/** Which table rows count as sensitive when marking elements for a masked screenshot. */
export interface MaskOptions {
	/** Row headers whose other cells are masked (exact, case-insensitive). Default `DEFAULT_SENSITIVE_ROW_HEADERS`. */
	readonly sensitiveRowHeaders?: readonly string[];
}

/** Elements marked for masking in every frame, and how to unmark them. */
export interface SensitiveMarks {
	/** One locator per frame with marks (each may match many elements). */
	readonly masks: readonly Locator[];
	/** How many elements were marked, across frames. */
	readonly count: number;
	/** Removes the marks (frames that navigated away meanwhile are skipped). */
	clear(): Promise<void>;
}

interface Candidate {
	readonly id: number;
	readonly text: string;
}

const CANDIDATE_ATTR = 'data-idp-candidate';

/** Runs in the page: marks the cells of sensitive-header rows and returns every text-bearing element. */
const collect = ({
	candidateAttr,
	maskAttr,
	nonce,
	headers,
}: {
	candidateAttr: string;
	maskAttr: string;
	nonce: string;
	headers: string[];
}): Candidate[] => {
	const norm = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
	const wanted = new Set(headers.map((header) => norm(header).toLowerCase()));
	const root = document.body ?? document.documentElement;
	for (const row of root.querySelectorAll('tr')) {
		const cells = [...row.children].filter((child) => child.tagName === 'TD' || child.tagName === 'TH');
		const header = cells.find((cell) => norm((cell as HTMLElement).innerText) !== '');
		if (header === undefined || !wanted.has(norm((header as HTMLElement).innerText).toLowerCase())) continue;
		for (const cell of cells) if (cell !== header) cell.setAttribute(maskAttr, nonce);
	}
	const candidates: Candidate[] = [];
	const ids = new Map<Element, number>();
	const add = (element: Element, text: string) => {
		let id = ids.get(element);
		if (id === undefined) {
			id = ids.size;
			ids.set(element, id);
			element.setAttribute(candidateAttr, String(id));
		}
		candidates.push({ id, text });
	};
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		const text = norm(node.textContent);
		if (text !== '' && node.parentElement !== null) add(node.parentElement, text);
	}
	for (const field of root.querySelectorAll('input, textarea')) {
		const value = (field as HTMLInputElement).value;
		if (norm(value) !== '') add(field, value);
	}
	return candidates;
};

/** Runs in the page: marks the chosen candidates and drops every candidate id. */
const mark = ({
	candidateAttr,
	maskAttr,
	nonce,
	ids,
}: {
	candidateAttr: string;
	maskAttr: string;
	nonce: string;
	ids: number[];
}): number => {
	const chosen = new Set(ids.map(String));
	for (const element of document.querySelectorAll(`[${candidateAttr}]`)) {
		if (chosen.has(element.getAttribute(candidateAttr) ?? '')) element.setAttribute(maskAttr, nonce);
		element.removeAttribute(candidateAttr);
	}
	return document.querySelectorAll(`[${maskAttr}="${nonce}"]`).length;
};

const unmark = ({ maskAttr, nonce }: { maskAttr: string; nonce: string }): void => {
	for (const element of document.querySelectorAll(`[${maskAttr}="${nonce}"]`)) element.removeAttribute(maskAttr);
};

/**
 * Marks, in every frame, each element whose text (or input value) the redactor would change — a known
 * sensitive value, a redaction pattern or a redaction term — plus every value cell of a row whose header is
 * in the sensitive-header list. The decision uses the redactor itself, so screenshot masks and text
 * redaction agree. Returns one mask locator per frame for `page.screenshot({ mask })`.
 */
export async function markSensitiveElements(
	page: Page,
	redactor: Redactor,
	options: MaskOptions = {},
): Promise<SensitiveMarks> {
	const nonce = randomUUID();
	const maskAttr = 'data-idp-mask';
	const headers = [...(options.sensitiveRowHeaders ?? DEFAULT_SENSITIVE_ROW_HEADERS)];
	const frames: Frame[] = page.frames().filter((frame) => !frame.isDetached());
	const masks: Locator[] = [];
	let count = 0;
	for (const frame of frames) {
		const candidates = await frame.evaluate(collect, { candidateAttr: CANDIDATE_ATTR, maskAttr, nonce, headers });
		const ids = candidates
			.filter((candidate) => redactor.redactString(candidate.text) !== candidate.text)
			.map((candidate) => candidate.id);
		const marked = await frame.evaluate(mark, { candidateAttr: CANDIDATE_ATTR, maskAttr, nonce, ids });
		if (marked > 0) {
			count += marked;
			masks.push(frame.locator(`[${maskAttr}="${nonce}"]`));
		}
	}
	return {
		masks,
		count,
		clear: async () => {
			for (const frame of frames) {
				if (frame.isDetached()) continue;
				try {
					await frame.evaluate(unmark, { maskAttr, nonce });
				} catch (error) {
					if (!isGoneFrameError(error)) throw error;
				}
			}
		},
	};
}
