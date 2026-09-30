import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { A11yNode } from '../port/Observation.js';
import { buildA11yTree, parseAriaSnapshot, type FrameSnapshot } from './a11ySnapshot.js';

// Recorded with Playwright 1.63 `frame.locator(':root').ariaSnapshot()` from a CoreOne-style frameset
// (banner / nav / content; the content frame shows the Sign On form with adjacent-cell labels).
const fixture = JSON.parse(
	readFileSync(new URL('./fixtures/frameset-login.snapshot.json', import.meta.url), 'utf8'),
) as { frames: FrameSnapshot[] };

function flatten(node: A11yNode): A11yNode[] {
	return [node, ...node.children.flatMap(flatten)];
}

describe('parseAriaSnapshot', () => {
	it('parses roles, JSON-quoted names, inline values, text nodes and /url props', () => {
		const root = parseAriaSnapshot(
			[
				'- document:',
				'  - link "Member Search":',
				'    - /url: /member/search',
				'  - textbox: teller01',
				'  - paragraph:',
				'    - text: Need help?',
				'  - listitem: one',
				'  - button "Say \\"hi\\""',
			].join('\n'),
		);
		expect(root.role).toBe('document');
		const [link, textbox, paragraph, listitem, button] = root.children;
		expect(link).toMatchObject({ role: 'link', name: 'Member Search', props: { url: '/member/search' }, children: [] });
		expect(textbox).toMatchObject({ role: 'textbox', name: '', value: 'teller01' });
		expect(paragraph?.children[0]).toMatchObject({ role: 'text', name: 'Need help?' });
		expect(listitem?.children).toEqual([{ role: 'text', name: 'one', children: [] }]);
		expect(button).toMatchObject({ role: 'button', name: 'Say "hi"' });
	});

	it('parses YAML single-quoted keys (names with ": "), attributes and quoted values', () => {
		const root = parseAriaSnapshot(
			[
				'- document:',
				'  - \'heading "Head: x" [level=2]\'',
				"  - 'row \"It''s: here\"':",
				'    - cell "a"',
				'  - checkbox [checked]',
				'  - option "Vacation Savings" [selected]',
				'  - textbox "Amount": "10.00"',
				'  - textbox "Note": \'a: b\'',
			].join('\n'),
		);
		const [heading, row, checkbox, option, amount, note] = root.children;
		expect(heading).toMatchObject({ role: 'heading', name: 'Head: x', states: { level: '2' } });
		expect(row).toMatchObject({ role: 'row', name: "It's: here" });
		expect(row?.children[0]).toMatchObject({ role: 'cell', name: 'a' });
		expect(checkbox).toMatchObject({ role: 'checkbox', states: { checked: true } });
		expect(option).toMatchObject({ role: 'option', name: 'Vacation Savings', states: { selected: true } });
		expect(amount).toMatchObject({ role: 'textbox', name: 'Amount', value: '10.00' });
		expect(note).toMatchObject({ role: 'textbox', name: 'Note', value: 'a: b' });
	});

	it('wraps several top-level nodes (no document line) in a document node', () => {
		const root = parseAriaSnapshot('- heading "A" [level=1]\n- button "B"');
		expect(root.role).toBe('document');
		expect(root.children.map((child) => child.role)).toEqual(['heading', 'button']);
	});

	it('treats an inline document text as a text child', () => {
		const root = parseAriaSnapshot('- document: CoreOne 7.4');
		expect(root.children).toEqual([{ role: 'text', name: 'CoreOne 7.4', children: [] }]);
	});
});

describe('buildA11yTree (recorded frameset fixture)', () => {
	const { tree, refs } = buildA11yTree(fixture.frames);
	const nodes = flatten(tree);

	it('grafts banner, nav and content under the top document, each named after its frame', () => {
		expect(tree.role).toBe('document');
		expect(tree.framePath).toEqual([]);
		const frames = tree.children.filter((child) => child.role === 'iframe');
		expect(frames.map((frame) => frame.name)).toEqual(['banner', 'nav', 'content']);
		expect(frames.map((frame) => frame.children[0]?.role)).toEqual(['document', 'document', 'document']);
		expect(frames[2]?.children[0]?.framePath).toEqual(['content']);
	});

	it('puts the login inputs and the Sign On button of the content frame in the one tree', () => {
		const textboxes = nodes.filter((node) => node.role === 'textbox');
		expect(textboxes).toHaveLength(2);
		expect(textboxes.every((node) => node.framePath[0] === 'content')).toBe(true);
		expect(textboxes[0]?.value).toBe('teller01');
		const button = nodes.find((node) => node.role === 'button');
		expect(button).toMatchObject({ name: 'Sign On', framePath: ['content'] });
		expect(nodes.find((node) => node.role === 'link' && node.name === 'Member Search')?.framePath).toEqual(['nav']);
	});

	it('assigns unique e<N> refs in tree order, never on document, iframe or text nodes', () => {
		const withRefs = nodes.filter((node) => node.ref !== undefined);
		const values = withRefs.map((node) => node.ref);
		expect(new Set(values).size).toBe(values.length);
		expect(values).toEqual(withRefs.map((_, index) => `e${index + 1}`));
		expect(nodes.filter((node) => ['document', 'iframe', 'text'].includes(node.role)).every((n) => !n.ref)).toBe(true);
	});

	it('maps every ref to its frame, role and position among same-role nodes of that frame', () => {
		const button = nodes.find((node) => node.role === 'button');
		expect(refs.get(button?.ref ?? '')).toEqual({ framePath: ['content'], role: 'button', nth: 0 });
		const passwordBox = nodes.filter((node) => node.role === 'textbox')[1];
		expect(refs.get(passwordBox?.ref ?? '')).toEqual({ framePath: ['content'], role: 'textbox', nth: 1 });
		const bannerCell = nodes.find((node) => node.role === 'cell' && node.framePath[0] === 'banner');
		expect(refs.get(bannerCell?.ref ?? '')).toEqual({ framePath: ['banner'], role: 'cell', nth: 0 });
		expect(refs.size).toBe(nodes.filter((node) => node.ref !== undefined).length);
	});

	it('appends a child frame with no iframe placeholder, and marks an unavailable frame', () => {
		const result = buildA11yTree([
			{ path: [], yaml: '- document:\n  - heading "Top" [level=1]', childPaths: [['hidden']] },
			{ path: ['hidden'], yaml: null, childPaths: [] },
		]);
		const frame = result.tree.children[1];
		expect(frame).toMatchObject({ role: 'iframe', name: 'hidden' });
		expect(frame?.children[0]).toMatchObject({ role: 'document', states: { unavailable: true }, children: [] });
	});

	it('is deterministic', () => {
		expect(buildA11yTree(fixture.frames).tree).toEqual(tree);
	});
});
