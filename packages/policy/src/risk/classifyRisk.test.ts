import { describe, expect, it } from 'vitest';
import { BANK, fixturePolicyConfig } from '../../test/fixtures/policyConfig.js';
import { resolvePolicy } from '../config/resolvePolicy.js';
import { classifyRisk } from './classifyRisk.js';

const policy = resolvePolicy(fixturePolicyConfig());
const at = (path: string) => `${BANK}${path}`;

describe('classifyRisk', () => {
	it('uses the registry risk when nothing raises it', () => {
		expect(classifyRisk({ actor: 'agent', kind: 'extract', currentUrl: at('/member/1') }, policy).risk).toBe('read');
		expect(
			classifyRisk({ actor: 'agent', kind: 'click', currentUrl: at('/search'), targetName: 'Search' }, policy).risk,
		).toBe('reversible');
	});

	it('classifies a "Confirm" click as irreversible', () => {
		const result = classifyRisk(
			{ actor: 'replay', kind: 'click', currentUrl: at('/subaccount/review'), targetName: 'Confirm' },
			policy,
		);
		expect(result.risk).toBe('irreversible');
		expect(result.reasons.join(' ')).toContain('^Confirm$');
	});

	it('normalizes whitespace and case in the control name', () => {
		expect(
			classifyRisk({ actor: 'agent', kind: 'click', currentUrl: at('/x'), targetName: '  confirm \n' }, policy).risk,
		).toBe('irreversible');
		expect(
			classifyRisk({ actor: 'agent', kind: 'click', currentUrl: at('/x'), targetName: 'Open  Account now' }, policy)
				.risk,
		).toBe('irreversible');
	});

	it('raises a press of Enter on a Submit control', () => {
		expect(
			classifyRisk({ actor: 'human', kind: 'press', currentUrl: at('/x'), targetName: 'Submit' }, policy).risk,
		).toBe('irreversible');
	});

	it('does not raise a non-raisable kind by its target name', () => {
		expect(
			classifyRisk({ actor: 'agent', kind: 'extract', currentUrl: at('/x'), targetName: 'Transfer total' }, policy)
				.risk,
		).toBe('read');
		expect(
			classifyRisk({ actor: 'agent', kind: 'fill', currentUrl: at('/x'), targetName: 'Transfer amount' }, policy).risk,
		).toBe('reversible');
	});

	it('never lowers: a declared read on a registry-reversible kind stays reversible', () => {
		expect(
			classifyRisk(
				{ actor: 'replay', kind: 'click', currentUrl: at('/x'), targetName: 'Search', declaredRisk: 'read' },
				policy,
			).risk,
		).toBe('reversible');
	});

	it('raises to the declared risk', () => {
		expect(
			classifyRisk(
				{ actor: 'replay', kind: 'select', currentUrl: at('/x'), targetName: 'Type', declaredRisk: 'irreversible' },
				policy,
			).risk,
		).toBe('irreversible');
	});

	it('treats a screen-changing action on an irreversible route as irreversible', () => {
		expect(
			classifyRisk(
				{ actor: 'agent', kind: 'click', currentUrl: at('/subaccount/confirm?x=1'), targetName: 'OK' },
				policy,
			).risk,
		).toBe('irreversible');
		// Reading on that route is still a read.
		expect(classifyRisk({ actor: 'agent', kind: 'extract', currentUrl: at('/subaccount/confirm') }, policy).risk).toBe(
			'read',
		);
	});

	it('raises a click or press whose destination (link href / form action) is an irreversible route', () => {
		const result = classifyRisk(
			{
				actor: 'agent',
				kind: 'click',
				currentUrl: at('/subaccount/new'),
				targetName: 'Next',
				destinationUrl: at('/subaccount/confirm?m=1'),
			},
			policy,
		);
		expect(result.risk).toBe('irreversible');
		expect(result.reasons.join(' ')).toContain('destination matches irreversible route /subaccount/confirm');
		expect(
			classifyRisk(
				{
					actor: 'human',
					kind: 'press',
					currentUrl: at('/x'),
					targetName: 'Amount',
					destinationUrl: '/subaccount/confirm',
				},
				policy,
			).risk,
		).toBe('irreversible');
	});

	it('leaves the risk unchanged when the destination is not an irreversible route', () => {
		expect(
			classifyRisk(
				{
					actor: 'agent',
					kind: 'click',
					currentUrl: at('/subaccount/new'),
					targetName: 'Next',
					destinationUrl: at('/subaccount/review'),
				},
				policy,
			).risk,
		).toBe('reversible');
		// A destination does not lower a page rule: acting on an irreversible route stays irreversible.
		expect(
			classifyRisk(
				{
					actor: 'agent',
					kind: 'click',
					currentUrl: at('/subaccount/confirm'),
					targetName: 'Cancel',
					destinationUrl: at('/member/detail'),
				},
				policy,
			).risk,
		).toBe('irreversible');
		// A kind that does not change the screen is not raised by a destination.
		expect(
			classifyRisk(
				{
					actor: 'agent',
					kind: 'fill',
					currentUrl: at('/x'),
					targetName: 'Amount',
					destinationUrl: at('/subaccount/confirm'),
				},
				policy,
			).risk,
		).toBe('reversible');
	});

	it('checks the navigate target (a GET can commit in a legacy app), not the page it leaves', () => {
		expect(
			classifyRisk(
				{ actor: 'agent', kind: 'navigate', currentUrl: at('/home'), targetUrl: at('/subaccount/confirm') },
				policy,
			).risk,
		).toBe('irreversible');
		expect(
			classifyRisk(
				{ actor: 'agent', kind: 'navigate', currentUrl: at('/subaccount/confirm'), targetUrl: at('/home') },
				policy,
			).risk,
		).toBe('read');
	});
});
