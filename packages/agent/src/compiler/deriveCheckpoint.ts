import {
	SCREEN_CHANGING_KINDS,
	type ActionKind,
	type Checkpoint,
	type FrameScope,
	type TargetRef,
} from '@idp/artifact-schema';
import type { FramePath } from '@idp/surface';
import { UncheckpointableStepError } from '../errors/UncheckpointableStepError.js';
import type { ScreenDiff } from '../trace/ScreenDiff.js';
import type { TextGuard } from './TextGuard.js';

/** The step a checkpoint is derived for. */
export interface CheckpointSubject {
	/** The trace step index (for the error). */
	readonly index: number;
	readonly kind: ActionKind;
	/** What the action changed; `null` when unknown. */
	readonly diff: ScreenDiff | null;
	/** The step's own target (a select falls back to it staying visible). */
	readonly target?: TargetRef;
}

/** Options of `deriveCheckpoint`: the guard that decides which screen text may become a checkpoint. */
export interface DeriveCheckpointOptions {
	readonly guard: TextGuard;
}

const SCREEN_CHANGING: ReadonlySet<ActionKind> = new Set(SCREEN_CHANGING_KINDS);
const ROLE_PREFERENCE = ['heading', 'button', 'link', 'tab', 'menuitem', 'combobox', 'textbox', 'checkbox', 'radio'];
const ROLE = /^[a-z]+$/;

/** A frame path as a by-name FrameScope, or `undefined` when a hop is unnamed (`#<i>`). */
function scopeOf(frame: FramePath): FrameScope | undefined {
	if (frame.some((hop) => hop === '' || hop.startsWith('#'))) return undefined;
	return frame.map((name) => ({ kind: 'by_name' as const, name }));
}

/** The frame that loaded first, then deeper frames before shallower ones (the top document last). */
function byFramePreference<T extends { readonly frame: FramePath }>(
	items: readonly T[],
	loaded: FramePath | null,
): T[] {
	const loadedKey = loaded === null ? undefined : JSON.stringify(loaded);
	return [...items]
		.map((item, order) => ({ item, order }))
		.sort((a, b) => {
			const aLoaded = JSON.stringify(a.item.frame) === loadedKey ? 0 : 1;
			const bLoaded = JSON.stringify(b.item.frame) === loadedKey ? 0 : 1;
			return aLoaded - bLoaded || b.item.frame.length - a.item.frame.length || a.order - b.order;
		})
		.map(({ item }) => item);
}

function textPresent(text: string, frame: FramePath): Checkpoint {
	const scope = scopeOf(frame);
	return { kind: 'text_present', text, ...(scope === undefined ? {} : { frame: scope }) };
}

function fromDiff(diff: ScreenDiff, guard: TextGuard): Checkpoint | undefined {
	const titles = byFramePreference(diff.titleChanges, diff.loadedFrame);
	// 1. a changed title (its part now visible in the frame) or a new heading; then the changed title itself.
	for (const change of titles) {
		const segment = change.visibleSegments.find(guard);
		if (segment !== undefined) return textPresent(segment, change.frame);
	}
	const heading = byFramePreference(diff.headingsAdded, diff.loadedFrame).find((item) => guard(item.text));
	if (heading !== undefined) return textPresent(heading.text, heading.frame);
	const title = titles.find((change) => guard(change.after));
	if (title !== undefined) return { kind: 'title_matches', title: title.after, match: 'contains' };

	// 2. a newly visible role+name element.
	const rank = (role: string) => {
		const index = ROLE_PREFERENCE.indexOf(role);
		return index === -1 ? ROLE_PREFERENCE.length : index;
	};
	const element = byFramePreference(diff.elementsAdded, diff.loadedFrame)
		.map((item, order) => ({ item, order }))
		.sort((a, b) => rank(a.item.role) - rank(b.item.role) || a.order - b.order)
		.map(({ item }) => item)
		.find((item) => ROLE.test(item.role) && guard(item.name) && scopeOf(item.frame) !== undefined);
	if (element !== undefined) {
		return {
			kind: 'element_visible',
			target: {
				description: `${element.role} "${element.name}"`.slice(0, 300),
				frame: scopeOf(element.frame) ?? [],
				ladder: [
					{
						kind: 'role',
						role: element.role,
						name: element.name,
						exact: true,
						rationale: `The ${element.role} "${element.name}" appeared after this step and was not on screen before it: it proves the screen moved on.`,
					},
				],
			},
		};
	}

	// 3. a route change.
	const route = byFramePreference(diff.routeChanges, diff.loadedFrame).find((change) => guard(change.after));
	if (route !== undefined) return { kind: 'url_matches', route: route.after };
	return undefined;
}

/**
 * Picks the checkpoint verified after a step (invariant 5) from what the step changed on screen, preferring
 * 1. a changed title or heading text, 2. a newly visible role+name element, 3. a route change — the frame that
 * loaded first. Only text the guard accepts is used, so no value, mask or placeholder becomes a checkpoint.
 * fill, extract and wait need none (`undefined`). A select that changes nothing is checked by its own target
 * staying visible; a dismissed dialog that changes nothing by a title text still present in its frame. Any
 * other screen-changing step without a verifiable change throws `UncheckpointableStepError`: the compiler
 * never emits one without a checkpoint.
 */
export function deriveCheckpoint(subject: CheckpointSubject, options: DeriveCheckpointOptions): Checkpoint | undefined {
	if (!SCREEN_CHANGING.has(subject.kind)) return undefined;
	const { diff } = subject;
	const derived = diff === null ? undefined : fromDiff(diff, options.guard);
	if (derived !== undefined) return derived;
	if (subject.kind === 'select' && subject.target !== undefined) {
		return { kind: 'element_visible', target: subject.target };
	}
	if (subject.kind === 'dismiss_dialog' && diff !== null) {
		const present = byFramePreference(diff.presentTexts, diff.loadedFrame).find((item) => options.guard(item.text));
		if (present !== undefined) return textPresent(present.text, present.frame);
	}
	throw new UncheckpointableStepError(subject.index, subject.kind);
}
