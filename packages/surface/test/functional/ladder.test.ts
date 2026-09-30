import { readFileSync } from 'node:fs';
import { CapabilityArtifactSchema, type LocatorRung, type TargetRef } from '@idp/artifact-schema';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TargetNotResolvedError, type Surface } from '../../src/index.js';
import {
	launchBrowserFixture,
	launchMockBank,
	SimulatedOperator,
	type BrowserFixture,
	type MockBank,
} from '../../src/testing/index.js';

const content = [{ kind: 'by_name' as const, name: 'content' }];
const rationale = 'functional test';
const formRow = (labelText: string, control: 'input' | 'button' = 'input'): LocatorRung => ({
	kind: 'structural',
	anchor: { kind: 'form_row', labelText, control },
	rationale,
});
const target = (description: string, ladder: LocatorRung[]): TargetRef => ({ description, frame: content, ladder });

const userId = target('User ID input', [formRow('User ID')]);
const password = target('Password input', [formRow('Password')]);
const signOn = target('Sign On button', [{ kind: 'role', role: 'button', name: 'Sign On', exact: true, rationale }]);

/** The Search button as tenant A shows it; the structural rung survives tenant B's relabelling. */
const searchButton = target('Search button on the Member Search page', [
	{ kind: 'role', role: 'button', name: 'Search', exact: true, rationale },
	{ kind: 'text', text: 'Search', match: 'exact', rationale },
	{
		kind: 'structural',
		anchor: { kind: 'nth_in_container', containerText: 'Member Search', element: 'button', index: 0 },
		rationale,
	},
]);

describe('surface: the locator ladder against mock-bank', () => {
	let tenantA: MockBank;
	let tenantB: MockBank;
	let browser: BrowserFixture;

	beforeAll(async () => {
		[tenantA, tenantB] = await Promise.all([launchMockBank({ tenant: 'a' }), launchMockBank({ tenant: 'b' })]);
		browser = await launchBrowserFixture();
	});
	afterEach(async () => {
		await browser.closeSessions();
		await Promise.all([tenantA.clearFaults(), tenantB.clearFaults()]);
		await Promise.all([tenantA.reset(), tenantB.reset()]);
	});
	afterAll(async () => {
		await browser?.close();
		await Promise.all([tenantA?.stop(), tenantB?.stop()]);
	});

	/** Signs on with the synthetic seed credentials, as a person would, and waits for Member Search. */
	async function signedOn(bank: MockBank): Promise<Surface> {
		const { surface, handle } = await browser.newSession({ origin: bank.origin });
		const operator = new SimulatedOperator(handle);
		await operator.open(`${bank.origin}/`);
		expect(await surface.check({ kind: 'text_present', text: 'Sign On', frame: content }, {}, 10_000)).toEqual({
			kind: 'held',
		});
		await operator.type(userId, 'teller01');
		await operator.type(password, 'synthetic-pass-01');
		await operator.click(signOn);
		expect(await surface.check({ kind: 'text_present', text: 'Member Search', frame: content }, {}, 10_000)).toEqual({
			kind: 'held',
		});
		return surface;
	}

	it('tenant A: resolves the Search button on its role rung (no drift)', async () => {
		const surface = await signedOn(tenantA);
		const resolution = await surface.resolve(searchButton);
		expect(resolution).toMatchObject({ rungIndex: 0, rungKind: 'role' });
		expect(resolution.fingerprint).toMatchObject({ role: 'button', name: 'Search', nameAttribute: 'btnGo' });
	});

	it('tenant B: "Find" defeats the role and text rungs; the structural rung still resolves (drift)', async () => {
		const surface = await signedOn(tenantB);
		const resolution = await surface.resolve(searchButton);
		expect(resolution).toMatchObject({ rungIndex: 2, rungKind: 'structural' });
		expect(resolution.fingerprint).toMatchObject({ role: 'button', name: 'Find', nameAttribute: 'btnGo' });
	});

	it('tenant B: the relabelled row fails its form_row rung and falls back to the new label', async () => {
		const surface = await signedOn(tenantB);
		const memberInput = target('Member number input', [formRow('Member #'), formRow('Account holder ID')]);
		const resolution = await surface.resolve(memberInput);
		expect(resolution).toMatchObject({ rungIndex: 1, rungKind: 'structural' });
		expect(resolution.fingerprint).toMatchObject({
			nameAttribute: 'txt1',
			labelCellText: 'Account holder ID',
			frameScope: content,
		});
	});

	it('control_missing: no rung matches → TargetNotResolvedError with per-rung counts', async () => {
		await tenantA.setFault('control_missing', { mode: 'always' });
		const surface = await signedOn(tenantA);
		const error = await surface.resolve(searchButton).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(TargetNotResolvedError);
		expect(error).toMatchObject({
			code: 'TARGET_UNRESOLVED',
			rungs: [
				{ index: 0, kind: 'role', matches: 0 },
				{ index: 1, kind: 'text', matches: 0 },
				{ index: 2, kind: 'structural', matches: 0 },
			],
		});
	});

	it('resolves every target of the member-lookup fixture, and each last-resort rung on its own', async () => {
		const fixture = CapabilityArtifactSchema.parse(
			JSON.parse(
				readFileSync(new URL('../../../artifact-schema/fixtures/member-lookup.artifact.json', import.meta.url), 'utf8'),
			),
		);
		const targetOf = (id: string): TargetRef => {
			const step = fixture.steps.find((candidate) => candidate.id === id);
			if (step === undefined || !('target' in step) || step.target === undefined) throw new Error(id);
			return step.target;
		};
		const { surface, handle } = await browser.newSession({ origin: tenantA.origin });
		const operator = new SimulatedOperator(handle);
		await operator.open(`${tenantA.origin}/`);
		await surface.check({ kind: 'text_present', text: 'Sign On', frame: content }, {}, 10_000);
		for (const id of ['s02-fill-user-id', 's03-fill-password']) {
			const ladder = targetOf(id).ladder;
			expect(await surface.resolve(targetOf(id))).toMatchObject({ rungIndex: 0 });
			expect(await surface.resolve({ ...targetOf(id), ladder: ladder.slice(-1) })).toMatchObject({ rungIndex: 0 });
		}
		await operator.type(targetOf('s02-fill-user-id'), 'teller01');
		await operator.type(targetOf('s03-fill-password'), 'synthetic-pass-01');
		await operator.click(targetOf('s04-click-sign-on'));
		await surface.check({ kind: 'text_present', text: 'Member Search', frame: content }, {}, 10_000);
		const memberInput = await surface.resolve(targetOf('s05-fill-member-id'));
		expect(memberInput.fingerprint).toMatchObject({ nameAttribute: 'txt1' });
		await operator.type(targetOf('s05-fill-member-id'), '12345');
		await operator.click(targetOf('s06-click-search'));
		expect(await surface.check({ kind: 'text_present', text: 'Member Inquiry', frame: content }, {}, 10_000)).toEqual({
			kind: 'held',
		});
		for (const [id, text] of [
			['s07-extract-savings-balance', '1523.47'],
			['s08-extract-member-name', 'Jane Sample'],
		] as const) {
			const primary = await surface.resolve(targetOf(id));
			expect(primary).toMatchObject({ rungIndex: 0, rungKind: 'structural' });
			expect(primary.fingerprint?.visibleText).toBe(text);
			const lastResort = await surface.resolve({ ...targetOf(id), ladder: targetOf(id).ladder.slice(-1) });
			expect(lastResort.fingerprint?.visibleText).toBe(text);
		}
	});

	it('checks element_visible / element_absent through the ladder', async () => {
		const surface = await signedOn(tenantA);
		expect(await surface.check({ kind: 'element_visible', target: searchButton }, {}, 0)).toEqual({ kind: 'held' });
		const absent = await surface.check({ kind: 'element_absent', target: searchButton }, {}, 0);
		expect(absent.kind).toBe('not_held');
	});
});
