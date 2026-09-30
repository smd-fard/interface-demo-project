import type { FrameLike } from './FrameResolver.js';

/** A fake frame tree for unit tests (no browser). */
export interface FakeFrameSpec {
	name?: string;
	url: string;
	title?: string;
	titleAttribute?: string;
	children?: FakeFrameSpec[];
}

export interface FakeFrame extends FrameLike<FakeFrame> {
	readonly spec: FakeFrameSpec;
}

export function fakeFrameTree(spec: FakeFrameSpec, parent: FakeFrame | null = null): FakeFrame {
	const children: FakeFrame[] = [];
	const frame: FakeFrame = {
		spec,
		name: () => spec.name ?? '',
		url: () => spec.url,
		title: async () => spec.title ?? '',
		childFrames: () => children,
		parentFrame: () => parent,
		frameElement: async () => ({
			getAttribute: async (name: string) => (name === 'title' ? (spec.titleAttribute ?? null) : null),
		}),
	};
	for (const child of spec.children ?? []) children.push(fakeFrameTree(child, frame));
	return frame;
}
