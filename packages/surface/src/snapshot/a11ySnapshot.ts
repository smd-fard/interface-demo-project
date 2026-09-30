import type { A11yNode, FramePath } from '../port/Observation.js';

/**
 * Pure parsing and merging of Playwright aria snapshots (the YAML-like text of `locator.ariaSnapshot()`).
 * Playwright snapshots one document at a time; `buildA11yTree` grafts each frame's document under its
 * `iframe` node so the whole frameset reads as one tree, and assigns the observation refs.
 */

/** A parsed snapshot node, before refs and frame paths are assigned. */
export interface ParsedAriaNode {
	role: string;
	name: string;
	value?: string;
	states?: Record<string, string | true>;
	props?: Record<string, string>;
	children: ParsedAriaNode[];
}

/** One frame's snapshot as captured by the Playwright layer. */
export interface FrameSnapshot {
	readonly path: FramePath;
	/** The frame document's aria snapshot, or `null` when it could not be taken (detached, blocked by a dialog). */
	readonly yaml: string | null;
	/** Paths of the child frames whose element is rendered, in document order (they fill the `iframe` nodes). */
	readonly childPaths: readonly FramePath[];
}

/** How the Playwright layer finds a ref again: the `nth` element with `role` in the frame's document. */
export interface RefTarget {
	readonly framePath: FramePath;
	readonly role: string;
	readonly nth: number;
}

const VALUE_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider']);
const UNREFFED_ROLES = new Set(['document', 'iframe', 'text']);

/** Reads a double-quoted (JSON) string starting at `start`; returns the value and the index after it. */
function readDoubleQuoted(text: string, start: number): { value: string; end: number } {
	let index = start + 1;
	while (index < text.length && text[index] !== '"') index += text[index] === '\\' ? 2 : 1;
	const raw = text.slice(start, index + 1);
	return { value: JSON.parse(raw) as string, end: index + 1 };
}

/** Reads a YAML single-quoted scalar (`''` escapes a quote) starting at `start`. */
function readSingleQuoted(text: string, start: number): { value: string; end: number } {
	let index = start + 1;
	let value = '';
	while (index < text.length) {
		if (text[index] === "'") {
			if (text[index + 1] === "'") {
				value += "'";
				index += 2;
				continue;
			}
			return { value, end: index + 1 };
		}
		value += text[index];
		index += 1;
	}
	return { value, end: index };
}

/** A YAML scalar value: plain, single-quoted or double-quoted. */
function readScalar(text: string): string {
	const trimmed = text.trim();
	if (trimmed.startsWith('"')) return readDoubleQuoted(trimmed, 0).value;
	if (trimmed.startsWith("'")) return readSingleQuoted(trimmed, 0).value;
	return trimmed;
}

/** Splits an item into its key and the rest (`""`, `":"` or `": value"`), honouring quotes. */
function splitItem(item: string): { key: string; rest: string } {
	if (item.startsWith("'")) {
		const { value, end } = readSingleQuoted(item, 0);
		return { key: value, rest: item.slice(end) };
	}
	if (item.startsWith('"')) {
		const { value, end } = readDoubleQuoted(item, 0);
		return { key: value, rest: item.slice(end) };
	}
	let index = 0;
	while (index < item.length) {
		const char = item[index];
		if (char === '"') {
			index = readDoubleQuoted(item, index).end;
			continue;
		}
		if (char === ':' && (index + 1 === item.length || item[index + 1] === ' ')) {
			return { key: item.slice(0, index), rest: item.slice(index) };
		}
		index += 1;
	}
	return { key: item, rest: '' };
}

/** Parses `role "name" [attr] [attr=value]`. */
function parseKey(key: string): Pick<ParsedAriaNode, 'role' | 'name' | 'states'> {
	const roleMatch = /^\/?[A-Za-z][\w-]*/.exec(key);
	const role = roleMatch?.[0] ?? key;
	let index = role.length;
	let name = '';
	while (key[index] === ' ') index += 1;
	if (key[index] === '"') {
		const read = readDoubleQuoted(key, index);
		name = read.value;
		index = read.end;
	} else if (key[index] === '/') {
		const close = key.indexOf('/', index + 1);
		name = key.slice(index, close === -1 ? key.length : close + 1);
		index = close === -1 ? key.length : close + 1;
	}
	const states: Record<string, string | true> = {};
	for (const match of key.slice(index).matchAll(/\[([^\]=]+)(?:=([^\]]*))?\]/g)) {
		const stateName = match[1];
		if (stateName !== undefined) states[stateName] = match[2] ?? true;
	}
	return Object.keys(states).length > 0 ? { role, name, states } : { role, name };
}

/**
 * Parses one aria snapshot into a tree. A single top-level `document` item is the root; anything else is
 * wrapped in a `document` node. Inline text of a non-input role becomes a `text` child.
 */
export function parseAriaSnapshot(yaml: string): ParsedAriaNode {
	const root: ParsedAriaNode = { role: 'document', name: '', children: [] };
	const stack: { indent: number; node: ParsedAriaNode }[] = [{ indent: -1, node: root }];
	for (const line of yaml.split('\n')) {
		const match = /^(\s*)- (.*)$/.exec(line);
		if (!match) continue;
		const indent = match[1]?.length ?? 0;
		const { key, rest } = splitItem(match[2] ?? '');
		while (stack.length > 1 && (stack.at(-1)?.indent ?? -1) >= indent) stack.pop();
		const parent = stack.at(-1)?.node ?? root;
		const inline = rest.startsWith(':') && rest.length > 1 ? readScalar(rest.slice(1)) : undefined;
		if (key.startsWith('/')) {
			parent.props = { ...parent.props, [key.slice(1)]: inline ?? '' };
			continue;
		}
		if (key === 'text') {
			parent.children.push({ role: 'text', name: inline ?? '', children: [] });
			continue;
		}
		const node: ParsedAriaNode = { ...parseKey(key), children: [] };
		if (inline !== undefined) {
			if (VALUE_ROLES.has(node.role)) node.value = inline;
			else node.children.push({ role: 'text', name: inline, children: [] });
		}
		parent.children.push(node);
		stack.push({ indent, node });
	}
	const only = root.children[0];
	return root.children.length === 1 && only?.role === 'document' ? only : root;
}

const pathKey = (path: FramePath) => JSON.stringify(path);

/**
 * Merges per-frame snapshots into one tree rooted at the top document (`path: []`). The k-th `iframe`
 * node of a frame receives its k-th child in `childPaths`; children without a placeholder (hidden frame
 * elements) are appended to the frame's root. Refs `e1, e2, …` are assigned in pre-order.
 */
export function buildA11yTree(frames: readonly FrameSnapshot[]): {
	tree: A11yNode;
	refs: Map<string, RefTarget>;
} {
	const byPath = new Map(frames.map((frame) => [pathKey(frame.path), frame]));
	const refs = new Map<string, RefTarget>();
	const roleCounters = new Map<string, number>();
	let nextRef = 1;

	const frameDocument = (path: FramePath, visiting: Set<string>): A11yNode => {
		const key = pathKey(path);
		const frame = byPath.get(key);
		if (frame === undefined || frame.yaml === null || visiting.has(key)) {
			return { role: 'document', name: '', states: { unavailable: true }, framePath: path, children: [] };
		}
		visiting.add(key);
		const pending = [...frame.childPaths];
		const convert = (parsed: ParsedAriaNode): A11yNode => {
			let ref: string | undefined;
			if (!UNREFFED_ROLES.has(parsed.role)) {
				ref = `e${nextRef++}`;
				const counterKey = `${key}\u0000${parsed.role}`;
				const nth = roleCounters.get(counterKey) ?? 0;
				roleCounters.set(counterKey, nth + 1);
				refs.set(ref, { framePath: path, role: parsed.role, nth });
			}
			let children: A11yNode[];
			let name = parsed.name;
			if (parsed.role === 'iframe') {
				const childPath = pending.shift();
				children = childPath === undefined ? [] : [frameDocument(childPath, visiting)];
				if (childPath !== undefined && name === '') name = childPath.at(-1) ?? '';
			} else {
				children = parsed.children.map(convert);
			}
			return {
				...(ref === undefined ? {} : { ref }),
				role: parsed.role,
				name,
				...(parsed.value === undefined ? {} : { value: parsed.value }),
				...(parsed.states === undefined ? {} : { states: parsed.states }),
				...(parsed.props === undefined ? {} : { props: parsed.props }),
				framePath: path,
				children,
			};
		};
		const root = convert(parseAriaSnapshot(frame.yaml));
		const extra = pending.map((childPath): A11yNode => ({
			role: 'iframe',
			name: childPath.at(-1) ?? '',
			framePath: path,
			children: [frameDocument(childPath, visiting)],
		}));
		visiting.delete(key);
		return extra.length === 0 ? root : { ...root, children: [...root.children, ...extra] };
	};

	return { tree: frameDocument([], new Set()), refs };
}
