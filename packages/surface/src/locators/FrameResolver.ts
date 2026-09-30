import type { FrameHop, FrameScope } from '@idp/artifact-schema';
import { FrameNotFoundError } from '../errors/FrameNotFoundError.js';
import { matchesRouteGlob } from '../internal/routeGlob.js';
import { normalizeText } from '../internal/normalizeText.js';
import type { FramePath } from '../port/Observation.js';

/** The part of a Playwright `Frame` the resolver needs (a Playwright `Frame` satisfies it). */
export interface FrameLike<F> {
	name(): string;
	url(): string;
	title(): Promise<string>;
	childFrames(): F[];
	parentFrame(): F | null;
	frameElement(): Promise<{ getAttribute(name: string): Promise<string | null> }>;
}

function describeHop(hop: FrameHop): string {
	switch (hop.kind) {
		case 'by_name':
			return `by_name "${hop.name}"`;
		case 'by_url_path':
			return `by_url_path "${hop.glob}"`;
		case 'by_title':
			return `by_title "${hop.title}"`;
	}
}

/** The URL's path; a URL that does not parse (e.g. an empty initial frame URL) is compared as it is. */
function pathOf(url: string): string {
	return URL.canParse(url) ? new URL(url).pathname : url;
}

async function matchesHop<F extends FrameLike<F>>(frame: F, hop: FrameHop): Promise<boolean> {
	switch (hop.kind) {
		case 'by_name':
			return frame.name() === hop.name;
		case 'by_url_path':
			return matchesRouteGlob(hop.glob, pathOf(frame.url()));
		case 'by_title': {
			const wanted = normalizeText(hop.title);
			const attribute = await (await frame.frameElement()).getAttribute('title');
			if (attribute !== null && normalizeText(attribute) === wanted) return true;
			return normalizeText(await frame.title()) === wanted;
		}
	}
}

/**
 * Resolves a FrameScope from `root`, hop by hop: each hop must match exactly one child frame of the
 * current frame, or `FrameNotFoundError` names the hop and how many frames it matched.
 */
export async function resolveFrameScope<F extends FrameLike<F>>(root: F, scope: FrameScope): Promise<F> {
	let current = root;
	for (const [hopIndex, hop] of scope.entries()) {
		const matches: F[] = [];
		for (const child of current.childFrames()) {
			if (await matchesHop(child, hop)) matches.push(child);
		}
		const only = matches[0];
		if (matches.length !== 1 || only === undefined) {
			throw new FrameNotFoundError(hopIndex, describeHop(hop), matches.length);
		}
		current = only;
	}
	return current;
}

function hopsTo<F extends FrameLike<F>>(frame: F): F[] {
	const hops: F[] = [];
	for (let current: F | null = frame; current?.parentFrame() != null; current = current.parentFrame()) {
		hops.unshift(current);
	}
	return hops;
}

/** The observation path of a frame: its name, or `#<index among its siblings>` when unnamed, per hop. */
export function framePathOf<F extends FrameLike<F>>(frame: F): FramePath {
	return hopsTo(frame).map((hop) => {
		if (hop.name() !== '') return hop.name();
		const siblings = hop.parentFrame()?.childFrames() ?? [];
		return `#${siblings.indexOf(hop)}`;
	});
}

/** A FrameScope that reaches the frame: by_name for named frames, by_url_path (its path) for unnamed ones. */
export function frameScopeOf<F extends FrameLike<F>>(frame: F): FrameScope {
	return hopsTo(frame).map((hop): FrameHop =>
		hop.name() !== '' ? { kind: 'by_name', name: hop.name() } : { kind: 'by_url_path', glob: pathOf(hop.url()) },
	);
}

/** Finds the frame at an observation path (the inverse of `framePathOf`), or `null`. */
export function frameAtPath<F extends FrameLike<F>>(root: F, path: FramePath): F | null {
	let current: F | undefined = root;
	for (const hop of path) {
		const children: F[] = current.childFrames();
		const index = /^#(\d+)$/.exec(hop)?.[1];
		current = index === undefined ? children.find((child) => child.name() === hop) : children[Number(index)];
		if (current === undefined) return null;
	}
	return current;
}
