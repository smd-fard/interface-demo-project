import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { A11yNode, Surface } from '../../src/index.js';
import {
	launchBrowserFixture,
	launchMockBank,
	SimulatedOperator,
	type BrowserFixture,
	type MockBank,
} from '../../src/testing/index.js';

const content = [{ kind: 'by_name' as const, name: 'content' }];
const flatten = (node: A11yNode): A11yNode[] => [node, ...node.children.flatMap(flatten)];

describe('surface: observe the mock-bank frameset', () => {
	let bank: MockBank;
	let browser: BrowserFixture;

	beforeAll(async () => {
		bank = await launchMockBank({ tenant: 'a' });
		browser = await launchBrowserFixture();
	});
	afterEach(async () => {
		await browser.closeSessions();
	});
	afterAll(async () => {
		await browser?.close();
		await bank?.stop();
	});

	async function openSignOn(): Promise<{ surface: Surface; operator: SimulatedOperator }> {
		const { surface, handle } = await browser.newSession({ origin: bank.origin });
		const operator = new SimulatedOperator(handle);
		await operator.open(`${bank.origin}/`);
		expect(await surface.check({ kind: 'text_present', text: 'Sign On', frame: content }, {}, 10_000)).toEqual({
			kind: 'held',
		});
		return { surface, operator };
	}

	it('merges banner, nav and content into one tree with refs, and the login inputs are present', async () => {
		const { surface } = await openSignOn();
		const observation = await surface.observe();

		expect(observation.frames.map((frame) => frame.path)).toEqual([[], ['banner'], ['nav'], ['content']]);
		const frameNodes =
			observation.tree.children.length > 0 ? flatten(observation.tree).filter((n) => n.role === 'iframe') : [];
		expect(frameNodes.map((node) => node.name)).toEqual(['banner', 'nav', 'content']);

		const nodes = flatten(observation.tree);
		const textboxes = nodes.filter((node) => node.role === 'textbox');
		expect(textboxes).toHaveLength(2);
		expect(textboxes.every((node) => node.framePath.join('/') === 'content' && node.ref?.startsWith('e'))).toBe(true);
		expect(nodes.find((node) => node.role === 'button')).toMatchObject({ name: 'Sign On', framePath: ['content'] });

		const refs = nodes.flatMap((node) => (node.ref === undefined ? [] : [node.ref]));
		expect(new Set(refs).size).toBe(refs.length);

		const contentFrame = observation.frames.find((frame) => frame.name === 'content');
		expect(contentFrame).toMatchObject({ title: 'CoreOne - Sign On', status: 200 });
		expect(contentFrame?.text).toContain('User ID');
		expect(observation.pendingDialog).toBeNull();
		expect(observation.lastNavigation?.status).toBe(200);
		expect(observation.digest).toMatch(/^[0-9a-f]{64}$/);
		expect((await surface.observe()).digest).toBe(observation.digest);
	});

	it('fingerprints an observation ref for the compiler (unlabelled input → its adjacent label cell)', async () => {
		const { surface } = await openSignOn();
		const observation = await surface.observe();
		const userId = flatten(observation.tree).find((node) => node.role === 'textbox');
		const fingerprint = await surface.describe({ kind: 'ref', ref: userId?.ref ?? 'missing' });
		expect(fingerprint).toMatchObject({
			role: 'textbox',
			name: '',
			tag: 'input',
			nameAttribute: 'txtUser',
			inputType: 'text',
			labelCellText: 'User ID',
			framePath: ['content'],
			frameScope: content,
			container: { element: 'input', index: 0 },
		});
	});

	it('changes the digest when a value changes', async () => {
		const { surface, operator } = await openSignOn();
		const before = await surface.observe();
		await operator.type(
			{
				description: 'User ID input',
				frame: content,
				ladder: [
					{
						kind: 'structural',
						anchor: { kind: 'form_row', labelText: 'User ID', control: 'input' },
						rationale: 'adjacent label cell',
					},
				],
			},
			'teller01',
		);
		const after = await surface.observe();
		expect(after.digest).not.toBe(before.digest);
		expect(flatten(after.tree).find((node) => node.role === 'textbox')?.value).toBe('teller01');
	});

	it('blocks a navigation to an origin outside the allowlist (network guard)', async () => {
		const { operator } = await openSignOn();
		await expect(operator.open('http://blocked.invalid/')).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/);
	});
});
