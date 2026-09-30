import { OBSERVATION_CLOSE, OBSERVATION_OPEN } from './formatObservation.js';

/** One addressable element of a rendered observation, as the model sees it (already placeholderized). */
export interface ObservedElement {
	readonly ref: string;
	readonly role: string;
	/** The accessible name, "" when there is none. */
	readonly name: string;
	/** The label inferred from the adjacent table cell, for unnamed controls and data cells. */
	readonly label?: string;
	/** The frame path (frame names from the top), `[]` for the top document. */
	readonly frame: readonly string[];
}

const QUOTED = String.raw`"(?:[^"\\]|\\.)*"`;
const NODE_LINE = new RegExp(String.raw`^(\s*)- (\S+)(?: (${QUOTED}))?(?: \[(e\d+)\])?(?: \(label: (${QUOTED})\))?`);
const FRAME_LINE = new RegExp(String.raw`^(\s*)- frame (${QUOTED})`);

/**
 * Reads back the elements with refs from the **last** `<observation>` block in `text` (the inverse of
 * `formatObservation` for what a model can address). Returns `[]` when there is no block. The scripted model
 * resolves its `{ role, name | label, frame }` targets with it, so it sees exactly what a real model sees.
 */
export function parseFormattedObservation(text: string): ObservedElement[] {
	const start = text.lastIndexOf(OBSERVATION_OPEN);
	if (start === -1) return [];
	const end = text.indexOf(OBSERVATION_CLOSE, start);
	const block = text.slice(start + OBSERVATION_OPEN.length, end === -1 ? undefined : end);
	const elements: ObservedElement[] = [];
	const frames: { indent: number; name: string }[] = [];
	let inTree = false;
	for (const line of block.split('\n')) {
		if (line === 'tree:') {
			inTree = true;
			continue;
		}
		if (!inTree) continue;
		if (line.startsWith('text [')) break;
		const indent = /^\s*/.exec(line)?.[0].length ?? 0;
		while (frames.length > 0 && (frames.at(-1)?.indent ?? -1) >= indent) frames.pop();
		const frame = FRAME_LINE.exec(line);
		if (frame !== null) {
			frames.push({ indent, name: JSON.parse(frame[2] ?? '""') as string });
			continue;
		}
		const match = NODE_LINE.exec(line);
		const ref = match?.[4];
		if (match === null || ref === undefined) continue;
		const label = match[5] === undefined ? undefined : (JSON.parse(match[5]) as string);
		elements.push({
			ref,
			role: match[2] ?? '',
			name: match[3] === undefined ? '' : (JSON.parse(match[3]) as string),
			...(label === undefined ? {} : { label }),
			frame: frames.map((entry) => entry.name),
		});
	}
	return elements;
}
