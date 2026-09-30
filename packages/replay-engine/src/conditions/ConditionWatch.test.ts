import type { KnownDialog, OutcomeRule } from '@idp/artifact-schema';
import { fakeObservation } from '@idp/surface/testing';
import { describe, expect, it } from 'vitest';
import { ConditionWatch, UNKNOWN_DIALOG } from './ConditionWatch.js';
import { knownDialogRules } from './knownDialogRules.js';
import { resolveRules } from './resolveRules.js';

const ORIGIN = 'http://127.0.0.1:4010';
const failedLoad: OutcomeRule = {
	code: 'failed_load',
	class: 'recoverable',
	description: 'HTTP 5xx',
	signature: { kind: 'http_status', min: 500, max: 599 },
	scope: 'any_step',
	recovery: { kind: 'retry', max: 2, backoffMs: 500 },
};
const maintenance: KnownDialog = {
	code: 'known_dialog',
	description: 'Maintenance notice',
	text: 'Scheduled maintenance',
	action: 'accept',
};
const rules = [
	...resolveRules({ artifactRules: [], profileRules: [failedLoad], stepId: 's06-click-search' }),
	...knownDialogRules([maintenance]),
];
const lastNavigation = { framePath: ['content'], url: `${ORIGIN}/member/detail`, status: 503, durationMs: 12 };

describe('ConditionWatch', () => {
	it('a known dialog (the profile list) matches its dialog_text rule, with the dismiss recovery', () => {
		const watch = new ConditionWatch(rules);
		const observation = fakeObservation(ORIGIN, {
			pendingDialog: { type: 'alert', message: 'Scheduled maintenance tonight at 11 PM' },
			lastNavigation,
		});
		expect(watch.detect(observation)).toBe('known_dialog');
		expect(watch.matchFor('known_dialog')?.rule).toMatchObject({
			class: 'recoverable',
			recovery: { kind: 'dismiss_dialog', action: 'accept' },
		});
	});

	it('while a dialog is pending only dialog rules count: an unrecognised one is unknown_dialog (not the stale 503)', () => {
		const watch = new ConditionWatch(rules);
		const observation = fakeObservation(ORIGIN, {
			pendingDialog: { type: 'confirm', message: 'Printer queue PRN-07 is offline. Retry?' },
			lastNavigation,
		});
		expect(watch.detect(observation)).toBe(UNKNOWN_DIALOG);
		expect(watch.matchFor(UNKNOWN_DIALOG)).toBeNull();
	});

	it('without a dialog the other rules apply: a 503 load is failed_load; a clean screen is nothing', () => {
		const watch = new ConditionWatch(rules);
		expect(watch.detect(fakeObservation(ORIGIN, { lastNavigation }))).toBe('failed_load');
		expect(watch.detect(fakeObservation(ORIGIN))).toBeNull();
	});
});
