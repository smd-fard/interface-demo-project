import type { Redactor } from '@idp/policy';
import type { A11yNode, FramePath, Observation } from '@idp/surface';
import type { AddedElement, RouteChange, ScreenDiff, TitleChange } from './ScreenDiff.js';

/** Options of `computeScreenDiff`. */
export interface ComputeScreenDiffOptions {
	/** Placeholderizes and masks every string before it is stored (invariant 3). */
	readonly redactor: Redactor;
	/** The frame of the last document load the action caused (`ActOutcome.navigation.framePath`), if any. */
	readonly loadedFrame: FramePath | null;
}

/** Roles whose appearance is a meaningful, stable screen change (cells and rows carry data, not identity). */
const CHECKPOINT_ROLES = new Set([
	'heading',
	'button',
	'link',
	'tab',
	'menuitem',
	'textbox',
	'combobox',
	'checkbox',
	'radio',
]);
const TITLE_SEPARATOR = /\s+[-–|:·]\s+|\s*\|\s*/;
const MIN_SEGMENT = 3;
const MAX_ELEMENTS = 50;
const MAX_TEXT = 200;

const key = (path: FramePath) => JSON.stringify(path);
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

function pathOf(url: string): string | null {
	if (!URL.canParse(url)) return null;
	const parsed = new URL(url);
	return parsed.protocol === 'about:' ? null : parsed.pathname;
}

function segments(title: string): string[] {
	return title
		.split(TITLE_SEPARATOR)
		.map(normalize)
		.filter((segment) => segment.length >= MIN_SEGMENT);
}

interface FrameView {
	readonly path: FramePath;
	readonly title: string;
	readonly route: string | null;
	readonly text: string;
}

function frames(observation: Observation): Map<string, FrameView> {
	return new Map(
		observation.frames.map((frame) => [
			key(frame.path),
			{ path: frame.path, title: normalize(frame.title), route: pathOf(frame.url), text: normalize(frame.text) },
		]),
	);
}

function collect(node: A11yNode, out: AddedElement[]): void {
	const name = normalize(node.name);
	if (name !== '' && CHECKPOINT_ROLES.has(node.role)) out.push({ frame: node.framePath, role: node.role, name });
	for (const child of node.children) collect(child, out);
}

function elements(observation: Observation): AddedElement[] {
	const out: AddedElement[] = [];
	collect(observation.tree, out);
	return out;
}

/**
 * What changed between the observation an action was decided on and the one after it: per-frame title and
 * route changes, headings and role+name elements that appeared, and whether a dialog opened or closed. Pure;
 * every stored string passes through `redactor.placeholderize` (known param values become `{{name}}`, other
 * sensitive values are masked), so the diff can be kept in the trace.
 */
export function computeScreenDiff(
	before: Observation,
	after: Observation,
	options: ComputeScreenDiffOptions,
): ScreenDiff {
	const safe = (text: string) => normalize(options.redactor.placeholderize(text)).slice(0, MAX_TEXT);
	const beforeFrames = frames(before);
	const afterFrames = frames(after);

	const titleChanges: TitleChange[] = [];
	const routeChanges: RouteChange[] = [];
	const presentTexts: { frame: FramePath; text: string }[] = [];
	for (const [frameKey, now] of afterFrames) {
		const was = beforeFrames.get(frameKey);
		const visible = segments(now.title).filter((segment) => now.text.includes(segment));
		for (const text of visible) presentTexts.push({ frame: now.path, text: safe(text) });
		if (now.title !== '' && now.title !== was?.title) {
			titleChanges.push({
				frame: now.path,
				before: was === undefined ? null : safe(was.title),
				after: safe(now.title),
				visibleSegments: visible.filter((segment) => !(was?.text ?? '').includes(segment)).map(safe),
			});
		}
		if (now.route !== null && now.route !== (was?.route ?? null)) {
			routeChanges.push({
				frame: now.path,
				before: was?.route == null ? null : safe(was.route),
				after: safe(now.route),
			});
		}
	}

	const seen = new Set(elements(before).map((element) => key([...element.frame, element.role, element.name])));
	const elementsAdded: AddedElement[] = [];
	const addedKeys = new Set<string>();
	for (const element of elements(after)) {
		const elementKey = key([...element.frame, element.role, element.name]);
		if (seen.has(elementKey) || addedKeys.has(elementKey)) continue;
		addedKeys.add(elementKey);
		if (elementsAdded.length < MAX_ELEMENTS) elementsAdded.push({ ...element, name: safe(element.name) });
	}

	return {
		loadedFrame: options.loadedFrame,
		titleChanges,
		headingsAdded: elementsAdded
			.filter((element) => element.role === 'heading')
			.map((element) => ({ frame: element.frame, text: element.name })),
		elementsAdded,
		routeChanges,
		presentTexts,
		dialogOpened: before.pendingDialog === null && after.pendingDialog !== null,
		dialogClosed: before.pendingDialog !== null && after.pendingDialog === null,
	};
}
