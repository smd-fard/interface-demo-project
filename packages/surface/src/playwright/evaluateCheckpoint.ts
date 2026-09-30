import type { Checkpoint } from '@idp/artifact-schema';
import type { Frame, Locator, Page } from 'playwright';
import { FrameNotFoundError } from '../errors/FrameNotFoundError.js';
import { TargetNotResolvedError } from '../errors/TargetNotResolvedError.js';
import { normalizeText } from '../internal/normalizeText.js';
import { matchesRouteGlob } from '../internal/routeGlob.js';
import { substituteTemplate } from '../internal/substituteTemplate.js';
import { resolveFrameScope } from '../locators/FrameResolver.js';
import type { LadderMatch } from '../locators/LadderResolver.js';
import type { Bindings } from '../port/Bindings.js';
import type { CheckResult } from '../port/CheckResult.js';

type Leaf = Exclude<Checkpoint, { kind: 'all_of' }>;

/** What checkpoint evaluation needs from the web surface. */
export interface CheckpointDeps {
	readonly page: Page;
	resolve(
		target: Extract<Leaf, { kind: 'element_visible' }>['target'],
		bindings: Bindings,
	): Promise<LadderMatch<Frame, Locator>>;
}

const HELD: CheckResult = { kind: 'held' };
const notHeld = (observed: string): CheckResult => ({ kind: 'not_held', observed });

async function frameText(frame: Frame): Promise<string> {
	return normalizeText(await frame.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => ''));
}

function framesOf(page: Page): Frame[] {
	return page.frames().filter((frame) => !frame.isDetached());
}

function routesOf(url: string): string[] {
	try {
		const parsed = new URL(url);
		return [parsed.pathname, parsed.pathname + parsed.search];
	} catch {
		return [];
	}
}

async function visibility(deps: CheckpointDeps, leaf: Extract<Leaf, { target: unknown }>, bindings: Bindings) {
	try {
		const match = await deps.resolve(leaf.target, bindings);
		return { visible: await match.locator.isVisible(), detail: `rung ${match.rungIndex} ${match.rungKind}` };
	} catch (error) {
		if (error instanceof TargetNotResolvedError || error instanceof FrameNotFoundError) {
			return { visible: false, detail: error.message };
		}
		throw error;
	}
}

/**
 * Evaluates a leaf checkpoint once. `observed` describes the screen with templates, paths and titles only:
 * substituted (possibly sensitive) values are never echoed.
 */
async function evaluateLeaf(deps: CheckpointDeps, leaf: Leaf, bindings: Bindings): Promise<CheckResult> {
	switch (leaf.kind) {
		case 'element_visible': {
			const { visible, detail } = await visibility(deps, leaf, bindings);
			return visible ? HELD : notHeld(`"${leaf.target.description}" not visible (${detail})`);
		}
		case 'element_absent': {
			const { visible, detail } = await visibility(deps, leaf, bindings);
			return visible ? notHeld(`"${leaf.target.description}" still visible (${detail})`) : HELD;
		}
		case 'text_present':
		case 'text_absent': {
			const wanted = normalizeText(substituteTemplate(leaf.text, bindings));
			const frames =
				leaf.frame === undefined ? framesOf(deps.page) : [await resolveFrameScope(deps.page.mainFrame(), leaf.frame)];
			let present = false;
			for (const frame of frames) {
				if ((await frameText(frame)).includes(wanted)) {
					present = true;
					break;
				}
			}
			const where = leaf.frame === undefined ? 'any frame' : 'the scoped frame';
			if (leaf.kind === 'text_present') return present ? HELD : notHeld(`text "${leaf.text}" not present in ${where}`);
			return present ? notHeld(`text "${leaf.text}" present in ${where}`) : HELD;
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
			const titles = await Promise.all(framesOf(deps.page).map((frame) => frame.title().catch(() => '')));
			const normalized = titles.map(normalizeText);
			const held = normalized.some((title) => (leaf.match === 'exact' ? title === wanted : title.includes(wanted)));
			return held ? HELD : notHeld(`title "${leaf.title}" not matched; titles: ${normalized.join(' | ')}`);
		}
	}
}

/** Evaluates a checkpoint once; `all_of` holds when every leaf holds in the same evaluation. */
export async function evaluateCheckpoint(
	deps: CheckpointDeps,
	checkpoint: Checkpoint,
	bindings: Bindings,
): Promise<CheckResult> {
	if (checkpoint.kind !== 'all_of') return evaluateLeaf(deps, checkpoint, bindings);
	for (const [index, leaf] of checkpoint.checks.entries()) {
		const result = await evaluateLeaf(deps, leaf, bindings);
		if (result.kind === 'not_held') return notHeld(`all_of[${index}] ${leaf.kind}: ${result.observed}`);
	}
	return HELD;
}
