import { createHash } from 'node:crypto';
import type { A11yNode, Observation } from '../port/Observation.js';

type DigestInput = Pick<Observation, 'url' | 'title' | 'frames' | 'tree' | 'pendingDialog'>;

function stripRefs(node: A11yNode): unknown {
	return [node.role, node.name, node.value ?? null, node.states ?? null, node.framePath, node.children.map(stripRefs)];
}

/**
 * A SHA-256 over what is on screen — the tree without refs (values included), the urls, titles and statuses
 * of every frame, and the pending dialog. Two observations of an unchanged screen have the same digest, which
 * is what the agent's no-progress detection compares.
 */
export function observationDigest(input: DigestInput): string {
	const canonical = JSON.stringify([
		input.url,
		input.title,
		input.frames.map((frame) => [frame.path, frame.url, frame.title, frame.status]),
		stripRefs(input.tree),
		input.pendingDialog === null ? null : [input.pendingDialog.type, input.pendingDialog.message],
	]);
	return createHash('sha256').update(canonical).digest('hex');
}
