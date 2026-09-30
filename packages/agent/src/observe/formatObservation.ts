import type { Redactor } from '@idp/policy';
import type { A11yNode, FrameInfo, FramePath, Observation } from '@idp/surface';

/** Options of `formatObservation`: the redactor (required) and the size bounds of the rendering. */
export interface FormatObservationOptions {
	/** Placeholderizes known param values (`{{memberId}}`) and masks everything else sensitive (invariant 3). */
	readonly redactor: Redactor;
	/** Upper bound on the whole rendering; deep subtrees are elided first (default 16 000 characters). */
	readonly maxChars?: number;
	/** Upper bound on each frame's page-text excerpt (default 600 characters). */
	readonly maxFrameTextChars?: number;
	/** Upper bound on a node's name, label or value (default 120 characters). */
	readonly maxNameChars?: number;
}

/** Opening and closing markers of a rendered observation (the scripted model looks for the last block). */
export const OBSERVATION_OPEN = '<observation>';
/** The closing marker of a rendered observation. */
export const OBSERVATION_CLOSE = '</observation>';

const DEFAULT_MAX_CHARS = 16_000;
const DEFAULT_MAX_FRAME_TEXT = 600;
const DEFAULT_MAX_NAME = 120;
/** Structural wrappers with no name carry nothing for the model: their children move up a level. */
const PASSTHROUGH_ROLES = new Set(['rowgroup', 'generic', 'none', 'presentation']);
const CELL_ROLES = new Set(['cell', 'gridcell', 'columnheader', 'rowheader']);
/** Controls that legacy screens leave unnamed (the label sits in the adjacent table cell). */
const CONTROL_ROLES = new Set([
	'textbox',
	'searchbox',
	'combobox',
	'listbox',
	'spinbutton',
	'checkbox',
	'radio',
	'slider',
]);

interface RenderNode {
	readonly line: string;
	readonly children: readonly RenderNode[];
}

/** An observation marker (`<observation`, `</observation`, any case or spacing) inside page content. */
const MARKER = /<(\s*\/?\s*observation)/gi;

/**
 * Neutralizes observation markers in page content (`<` → `&lt;`), so page text can neither close the block
 * early nor open a new one that the parser would read as the latest observation (prompt injection).
 */
export function neutralizeMarkers(text: string): string {
	return text.replace(MARKER, '&lt;$1');
}

function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** The path and query of a URL (the origin is noise for the model); the raw text when it does not parse. */
function shortUrl(url: string): string {
	if (!URL.canParse(url)) return url;
	const parsed = new URL(url);
	return `${parsed.pathname}${parsed.search}`;
}

/**
 * The label of a legacy form control or data cell: the nearest named cell before it in its table row, e.g.
 * `User ID` for the unnamed textbox in the next cell, `Share Savings` for the balance cell.
 */
function inferLabel(node: A11yNode, ancestors: readonly A11yNode[]): string | undefined {
	if (node.ref === undefined) return undefined;
	const isCell = CELL_ROLES.has(node.role);
	if (!isCell && (node.name !== '' || !CONTROL_ROLES.has(node.role))) return undefined;
	const chain = [...ancestors, node];
	for (let index = chain.length - 1; index > 0; index -= 1) {
		const cell = chain[index];
		const row = chain[index - 1];
		if (cell === undefined || row === undefined || !CELL_ROLES.has(cell.role) || row.role !== 'row') continue;
		const position = row.children.indexOf(cell);
		for (let sibling = position - 1; sibling >= 0; sibling -= 1) {
			const candidate = row.children[sibling];
			if (candidate !== undefined && CELL_ROLES.has(candidate.role) && candidate.name.trim() !== '') {
				return candidate.name;
			}
		}
		return undefined;
	}
	return undefined;
}

const pathKey = (path: FramePath) => JSON.stringify(path);

/**
 * Renders an observation for the model as compact indented text: `- role "name" [ref] (label: "…") value="…"`,
 * frames as `- frame "<name>" url=<path>`, the pending dialog, and a short page-text excerpt per frame (legacy
 * messages are often plain text). Every string passes through `redactor.placeholderize` before it is written,
 * so the model sees `{{memberId}}` and masks, never a raw value (invariant 3), and any `<observation` /
 * `</observation` marker in page content is neutralized, so the block has exactly one opening and one closing
 * marker (page content is untrusted data). Unnamed structural wrappers are
 * elided; over `maxChars`, the deepest subtrees are replaced by `… N deeper nodes elided`, deterministically.
 */
export function formatObservation(observation: Observation, options: FormatObservationOptions): string {
	const { redactor } = options;
	const maxName = options.maxNameChars ?? DEFAULT_MAX_NAME;
	const safe = (text: string, max = maxName) => truncate(neutralizeMarkers(redactor.placeholderize(text)), max);
	const quote = (text: string) => JSON.stringify(safe(text));
	const framesByPath = new Map<string, FrameInfo>(observation.frames.map((frame) => [pathKey(frame.path), frame]));

	function nodeLine(node: A11yNode, ancestors: readonly A11yNode[]): string {
		let line = `- ${node.role}`;
		if (node.name !== '') line += ` ${quote(node.name)}`;
		if (node.ref !== undefined) line += ` [${node.ref}]`;
		const label = inferLabel(node, ancestors);
		if (label !== undefined) line += ` (label: ${quote(label)})`;
		if (node.value !== undefined) line += ` value=${quote(node.value)}`;
		for (const [state, value] of Object.entries(node.states ?? {})) {
			line += value === true ? ` [${state}]` : ` [${state}=${safe(value, 40)}]`;
		}
		const url = node.props?.['url'];
		if (url !== undefined) line += ` -> ${safe(url, 200)}`;
		return line;
	}

	function build(node: A11yNode, ancestors: readonly A11yNode[]): RenderNode[] {
		const nextAncestors = [...ancestors, node];
		const children = () => node.children.flatMap((child) => build(child, nextAncestors));
		if (node.role === 'iframe') {
			const document = node.children[0];
			if (document === undefined) return [{ line: '- frame (not loaded)', children: [] }];
			const frame = framesByPath.get(pathKey(document.framePath));
			const name = document.framePath.at(-1) ?? '';
			const url = frame === undefined ? '' : ` url=${safe(shortUrl(frame.url), 200)}`;
			return [{ line: `- frame ${JSON.stringify(safe(name))}${url}`, children: children() }];
		}
		if (node.role === 'document' || (PASSTHROUGH_ROLES.has(node.role) && node.name === '')) return children();
		return [{ line: nodeLine(node, ancestors), children: children() }];
	}

	const roots = build(observation.tree, []);
	const header = [OBSERVATION_OPEN, `page: ${quote(observation.title)} url=${safe(shortUrl(observation.url), 200)}`];
	if (observation.pendingDialog !== null) {
		header.push(
			`dialog: ${observation.pendingDialog.type} ${JSON.stringify(safe(observation.pendingDialog.message, 500))}`,
		);
	}
	header.push('tree:');
	const maxText = options.maxFrameTextChars ?? DEFAULT_MAX_FRAME_TEXT;
	const footer: string[] = [];
	for (const frame of observation.frames) {
		if (frame.text.trim() === '') continue;
		const label = frame.path.length === 0 ? 'top' : frame.path.join('/');
		let excerpt = safe(frame.text, maxText);
		if (frame.textTruncated && !excerpt.endsWith('…')) excerpt += '…';
		footer.push(`text [${label}]: ${JSON.stringify(excerpt)}`);
	}
	footer.push(OBSERVATION_CLOSE);

	const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
	const assemble = (lines: readonly string[]) => [...header, ...lines, ...footer].join('\n');
	const deepest = maxDepth(roots);
	for (let limit = deepest; limit >= 0; limit -= 1) {
		const text = assemble(renderLines(roots, 0, limit));
		if (text.length <= maxChars) return text;
	}
	// Even the top level does not fit: keep the leading lines that do.
	const lines = renderLines(roots, 0, 0);
	const kept: string[] = [];
	for (const line of lines) {
		if (assemble([...kept, line, '… truncated']).length > maxChars) break;
		kept.push(line);
	}
	return assemble([...kept, '… truncated']);
}

function maxDepth(nodes: readonly RenderNode[], depth = 0): number {
	return nodes.reduce((max, node) => Math.max(max, depth, maxDepth(node.children, depth + 1)), depth);
}

function countNodes(nodes: readonly RenderNode[]): number {
	return nodes.reduce((sum, node) => sum + 1 + countNodes(node.children), 0);
}

function renderLines(nodes: readonly RenderNode[], depth: number, limit: number): string[] {
	const indent = '  '.repeat(depth);
	const lines: string[] = [];
	for (const node of nodes) {
		lines.push(indent + node.line);
		if (node.children.length === 0) continue;
		if (depth + 1 > limit) lines.push(`${indent}  … ${countNodes(node.children)} deeper nodes elided`);
		else lines.push(...renderLines(node.children, depth + 1, limit));
	}
	return lines;
}
