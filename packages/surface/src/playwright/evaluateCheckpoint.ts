import type { Checkpoint } from '@idp/artifact-schema';
import type { Frame, Locator, Page } from 'playwright';
import { FrameNotFoundError } from '../errors/FrameNotFoundError.js';
import { TargetNotResolvedError } from '../errors/TargetNotResolvedError.js';
import { isGoneFrameError } from '../internal/isGoneFrameError.js';
import { normalizeText } from '../internal/normalizeText.js';
import { matchesRouteGlob } from '../internal/routeGlob.js';
import { substituteTemplate } from '../internal/substituteTemplate.js';
import { framePathOf, resolveFrameScope } from '../locators/FrameResolver.js';
import type { LadderMatch } from '../locators/LadderResolver.js';
import type { Bindings } from '../port/Bindings.js';
import type { CheckResult } from '../port/CheckResult.js';
import { firstLine, readFrameText, titleOrEmpty } from './frameReads.js';

type Leaf = Exclude<Checkpoint, { kind: 'all_of' }>;

/** What checkpoint evaluation needs from the web surface. */
export interface CheckpointDeps {
	readonly page: Page;
	resolve(
		target: Extract<Leaf, { kind: 'element_visible' }>['target'],
		bindings: Bindings,
	): Promise<LadderMatch<Frame, Locator>>;
}

/**
 * One leaf evaluation. `unreadable`: the page could not be read (a frame went away mid-read, or the scoped frame
 * is not there): the checkpoint is neither held nor refuted — in particular a negative check (`text_absent`,
 * `element_absent`) never passes on it. `check` polls again; at its bound the result is `not_held` with
 * `frame unreadable: <reason>`.
 */
type LeafResult = CheckResult | { readonly kind: 'unreadable'; readonly reason: string };

const HELD: CheckResult = { kind: 'held' };
const notHeld = (observed: string): CheckResult => ({ kind: 'not_held', observed });
const unreadable = (reason: string): LeafResult => ({ kind: 'unreadable', reason });

function framesOf(page: Page): Frame[] {
	return page.frames().filter((frame) => !frame.isDetached());
}

function routesOf(url: string): string[] {
	// A frame URL Playwright reports is normally absolute; one that is not (e.g. an empty initial URL) has no route.
	if (!URL.canParse(url)) return [];
	const parsed = new URL(url);
	return [parsed.pathname, parsed.pathname + parsed.search];
}

type Visibility =
	| { readonly kind: 'visible' | 'not_visible'; readonly detail: string }
	| { readonly kind: 'unreadable'; readonly reason: string };

/**
 * Whether the target is visible, from a single ladder pass (`check` does the polling). A target no rung
 * matches is `not_visible`; one whose frame scope does not resolve, whose rung counting failed (the frame went
 * away mid-pass) or whose visibility could not be read is `unreadable`.
 */
async function visibility(
	deps: CheckpointDeps,
	leaf: Extract<Leaf, { target: unknown }>,
	bindings: Bindings,
): Promise<Visibility> {
	let match: LadderMatch<Frame, Locator>;
	try {
		match = await deps.resolve(leaf.target, bindings);
	} catch (error) {
		if (error instanceof FrameNotFoundError) return { kind: 'unreadable', reason: error.message };
		if (error instanceof TargetNotResolvedError) {
			const failed = error.rungs.find((rung) => rung.error !== undefined);
			if (failed !== undefined) {
				return { kind: 'unreadable', reason: `rung ${failed.index} ${failed.kind}: ${failed.error ?? ''}` };
			}
			return { kind: 'not_visible', detail: error.message };
		}
		throw error;
	}
	const detail = `rung ${match.rungIndex} ${match.rungKind}`;
	try {
		return { kind: (await match.locator.isVisible()) ? 'visible' : 'not_visible', detail };
	} catch (error) {
		if (isGoneFrameError(error)) return { kind: 'unreadable', reason: firstLine(error) };
		throw error;
	}
}

/** Whether `wanted` is in any of the frames: `unreadable` only when it was found nowhere and a frame could not be read. */
async function textIn(
	deps: CheckpointDeps,
	leaf: Extract<Leaf, { kind: 'text_present' | 'text_absent' }>,
	wanted: string,
): Promise<{ readonly kind: 'present' | 'absent' } | { readonly kind: 'unreadable'; readonly reason: string }> {
	let frames: Frame[];
	if (leaf.frame === undefined) {
		frames = framesOf(deps.page);
	} else {
		try {
			frames = [await resolveFrameScope(deps.page.mainFrame(), leaf.frame)];
		} catch (error) {
			if (error instanceof FrameNotFoundError) return { kind: 'unreadable', reason: error.message };
			throw error;
		}
	}
	let gone: string | undefined;
	for (const frame of frames) {
		const read = await readFrameText(frame);
		if (read.kind === 'gone')
			gone ??= `frame "${framePathOf(frame).join('/') || '(top)'}" went away while read (${read.reason})`;
		else if (read.text.includes(wanted)) return { kind: 'present' };
	}
	return gone === undefined ? { kind: 'absent' } : { kind: 'unreadable', reason: gone };
}

/**
 * Evaluates a leaf checkpoint once. `observed` describes the screen with templates, paths and titles only:
 * substituted (possibly sensitive) values are never echoed.
 */
async function evaluateLeaf(deps: CheckpointDeps, leaf: Leaf, bindings: Bindings): Promise<LeafResult> {
	switch (leaf.kind) {
		case 'element_visible': {
			const seen = await visibility(deps, leaf, bindings);
			if (seen.kind === 'visible') return HELD;
			if (seen.kind === 'unreadable') return unreadable(seen.reason);
			return notHeld(`"${leaf.target.description}" not visible (${seen.detail})`);
		}
		case 'element_absent': {
			const seen = await visibility(deps, leaf, bindings);
			if (seen.kind === 'unreadable') return unreadable(seen.reason);
			return seen.kind === 'visible' ? notHeld(`"${leaf.target.description}" still visible (${seen.detail})`) : HELD;
		}
		case 'text_present':
		case 'text_absent': {
			const wanted = normalizeText(substituteTemplate(leaf.text, bindings));
			const found = await textIn(deps, leaf, wanted);
			const where = leaf.frame === undefined ? 'any frame' : 'the scoped frame';
			if (found.kind === 'present') {
				return leaf.kind === 'text_present' ? HELD : notHeld(`text "${leaf.text}" present in ${where}`);
			}
			if (found.kind === 'unreadable') return unreadable(found.reason);
			return leaf.kind === 'text_absent' ? HELD : notHeld(`text "${leaf.text}" not present in ${where}`);
		}
		case 'url_matches': {
			const glob = substituteTemplate(leaf.route, bindings);
			const frames = framesOf(deps.page);
			if (frames.some((frame) => routesOf(frame.url()).some((route) => matchesRouteGlob(glob, route)))) return HELD;
			const paths = frames.map((frame) => routesOf(frame.url())[0] ?? '(none)');
			return notHeld(`route "${leaf.route}" not matched; frame paths: ${paths.join(', ')}`);
		}
		case 'title_matches': {
			const wanted = normalizeText(substituteTemplate(leaf.title, bindings));
			// A frame that went away mid-read has no title yet (''): it cannot match, the next poll reads it again.
			const titles = await Promise.all(framesOf(deps.page).map((frame) => titleOrEmpty(frame)));
			const normalized = titles.map(normalizeText);
			const held = normalized.some((title) => (leaf.match === 'exact' ? title === wanted : title.includes(wanted)));
			return held ? HELD : notHeld(`title "${leaf.title}" not matched; titles: ${normalized.join(' | ')}`);
		}
	}
}

function asCheckResult(result: LeafResult): CheckResult {
	return result.kind === 'unreadable' ? notHeld(`frame unreadable: ${result.reason}`) : result;
}

/** Evaluates a checkpoint once; `all_of` holds when every leaf holds in the same evaluation. */
export async function evaluateCheckpoint(
	deps: CheckpointDeps,
	checkpoint: Checkpoint,
	bindings: Bindings,
): Promise<CheckResult> {
	if (checkpoint.kind !== 'all_of') return asCheckResult(await evaluateLeaf(deps, checkpoint, bindings));
	for (const [index, leaf] of checkpoint.checks.entries()) {
		const result = asCheckResult(await evaluateLeaf(deps, leaf, bindings));
		if (result.kind === 'not_held') return notHeld(`all_of[${index}] ${leaf.kind}: ${result.observed}`);
	}
	return HELD;
}
