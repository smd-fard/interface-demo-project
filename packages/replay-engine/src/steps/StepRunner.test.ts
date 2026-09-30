import type { OutcomeRule, Step, TargetRef } from '@idp/artifact-schema';
import { FULL_MASK } from '@idp/policy';
import {
	ApprovalRequiredError,
	PolicyDeniedError,
	TargetNotResolvedError,
	WaitTimeoutError,
	type Surface,
} from '@idp/surface';
import { fakeObservation, type FakeSurfaceOptions } from '@idp/surface/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { CheckpointVerifier } from '../checkpoints/CheckpointVerifier.js';
import { ReplayError } from '../errors/ReplayError.js';
import { fakeReplaySession, ORIGIN, type FakeReplaySessionFixture } from '../fakeReplaySession.test-helper.js';
import { createValueBinder } from '../params/bindValues.js';
import { InMemoryCredentialProvider } from '../params/InMemoryCredentialProvider.js';
import { resolveReplayOptions } from '../ReplayOptions.js';
import { RunState } from './RunState.js';
import type { StepContext } from './StepContext.js';
import { StepRunner, type StepRunnerOptions } from './StepRunner.js';

const content = [{ kind: 'by_name' as const, name: 'content' }];
const rationale = 'unit test';
const target = (description: string): TargetRef => ({
	description,
	frame: content,
	ladder: [{ kind: 'role', role: 'button', name: description, exact: true, rationale }],
});
const textIn = (text: string) => ({ kind: 'text_present' as const, text, frame: content });
const base = (id: string, risk: Step['risk'] = 'read') => ({
	id,
	description: `step ${id}`,
	phase: 'main' as const,
	risk,
});

/** One step of every kind, each screen-changing one with a checkpoint. */
const EVERY_KIND: Step[] = [
	{ ...base('s01-navigate'), kind: 'navigate', route: '/member/search', checkpoint: textIn('Member Search') },
	{
		...base('s02-fill', 'reversible'),
		kind: 'fill',
		target: target('Member #'),
		value: { kind: 'param', name: 'memberId' },
		sensitive: true,
	},
	{
		...base('s03-select', 'reversible'),
		kind: 'select',
		target: target('Product'),
		option: { kind: 'literal', value: 'Vacation Savings' },
		checkpoint: textIn('Vacation Savings'),
	},
	{ ...base('s04-press'), kind: 'press', key: 'Enter', checkpoint: textIn('Member Inquiry') },
	{ ...base('s05-click'), kind: 'click', target: target('Search'), checkpoint: textIn('Member Inquiry') },
	{
		...base('s06-extract'),
		kind: 'extract',
		target: target('Share Savings'),
		output: 'savingsBalance',
		parse: { kind: 'decimal' },
	},
	{ ...base('s07-wait'), kind: 'wait', until: textIn('Balances'), timeoutMs: 2000 },
	{
		...base('s08-dismiss'),
		kind: 'dismiss_dialog',
		match: 'Scheduled maintenance',
		action: 'accept',
		checkpoint: textIn('Member Inquiry'),
	},
];

describe('StepRunner and the eight step handlers (define-action touch point 4)', () => {
	let fixture: FakeReplaySessionFixture;
	afterEach(async () => {
		await fixture.cleanup();
	});

	async function runner(surface: Partial<FakeSurfaceOptions> = {}, options: StepRunnerOptions = {}) {
		fixture = await fakeReplaySession(surface);
		fixture.redactor.addSensitiveValue({ value: '12345', paramName: 'memberId' });
		const state = new RunState();
		const context: StepContext = {
			runId: fixture.session.runId,
			surface: fixture.session.surface,
			runLog: fixture.session.runLog,
			redactor: fixture.redactor,
			binder: createValueBinder({
				params: { memberId: '12345' },
				credentials: new InMemoryCredentialProvider({}),
				redactor: fixture.redactor,
			}),
			verifier: new CheckpointVerifier({ surface: fixture.session.surface }),
			options: resolveReplayOptions(),
			clock: fixture.clock,
			outputs: new Map([
				[
					'savingsBalance',
					{ name: 'savingsBalance', description: 'b', type: { kind: 'decimal', scale: 2 }, sensitive: true },
				],
			]),
			state,
		};
		return { run: new StepRunner(context, options), state };
	}

	async function failureOf(promise: Promise<unknown>): Promise<ReplayError> {
		const error = await promise.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(ReplayError);
		return error as ReplayError;
	}

	it('success: every kind acts once as replay with its step id and declared risk, then its checkpoint is verified', async () => {
		const { run, state } = await runner({
			onAct: (action) => ({
				kind: action.kind,
				url: `${ORIGIN}/`,
				navigation: null,
				...(action.kind === 'extract' ? { extracted: '$1,523.47' } : {}),
				...('target' in action && action.target !== undefined
					? { resolution: { rungIndex: action.kind === 'click' ? 2 : 0, rungKind: 'role' as const } }
					: {}),
			}),
		});
		expect(await run.run(EVERY_KIND)).toEqual({ kind: 'completed' });
		const acts = fixture.surface.acts;
		expect(acts.map((action) => [action.kind, action.actor, action.stepId, action.declaredRisk])).toEqual(
			EVERY_KIND.map((step) => [step.kind, 'replay', step.id, step.risk]),
		);
		expect(acts[0]).toMatchObject({ kind: 'navigate', route: '/member/search', bindings: { memberId: '12345' } });
		expect(acts[1]).toMatchObject({ kind: 'fill', value: '12345', sensitive: true });
		expect(acts[2]).toMatchObject({ kind: 'select', option: 'Vacation Savings' });
		expect(acts[3]).toMatchObject({ kind: 'press', key: 'Enter' });
		expect(acts[3]).not.toHaveProperty('target');
		expect(acts[6]).toMatchObject({ kind: 'wait', until: textIn('Balances'), timeoutMs: 2000 });
		expect(acts[7]).toMatchObject({ kind: 'dismiss_dialog', match: 'Scheduled maintenance', action: 'accept' });

		// Drift: the click resolved on rung 2 (FR11).
		expect(state.drift).toEqual([{ stepId: 's05-click', rungIndex: 2, rungKind: 'role' }]);
		// The extract kept the raw text and seeded the redactor with it and its parsed form at once.
		expect(state.extractions.get('savingsBalance')).toMatchObject({ raw: '$1,523.47', stepIndex: 5 });
		expect(fixture.redactor.redactString('balance 1523.47')).toBe(`balance ${FULL_MASK}`);

		const entries = await fixture.runLog.entries();
		const checkpoints = entries.filter((entry) => entry.kind === 'checkpoint');
		expect(checkpoints.map((entry) => [entry.stepId, entry.result])).toEqual([
			['s01-navigate', 'held'],
			['s03-select', 'held'],
			['s04-press', 'held'],
			['s05-click', 'held'],
			['s08-dismiss', 'held'],
		]);
		expect(entries.filter((entry) => entry.kind === 'action')).toHaveLength(8);
		expect(entries.filter((entry) => entry.kind === 'locator_resolved')).toHaveLength(4);
		const text = JSON.stringify(entries);
		expect(text).not.toContain('12345');
		expect(text).not.toContain('1,523.47');
	});

	it('policy blocks: the guard refuses before acting → policy_denied at that step; no checkpoint, no later step', async () => {
		const { run } = await runner({
			throwOnActCall: {
				call: 5,
				error: new PolicyDeniedError('click', 'route_not_allowed', 'http://127.0.0.1:4010/admin', 'pre_action'),
			},
		});
		const error = await failureOf(run.run(EVERY_KIND));
		expect(error).toMatchObject({
			code: 'policy_denied',
			step: { index: 4, id: 's05-click' },
			observed: 'route_not_allowed (not performed)',
		});
		expect(fixture.surface.acts).toHaveLength(5);
		const entries = await fixture.runLog.entries();
		expect(entries.filter((entry) => entry.kind === 'action').map((entry) => entry.stepId)).toEqual([
			's01-navigate',
			's02-fill',
			's03-select',
			's04-press',
		]);
		expect(entries.some((entry) => entry.kind === 'checkpoint' && entry.stepId === 's05-click')).toBe(false);
	});

	it('a checkpoint that does not hold is checkpoint_failed: "the click did not throw" is not success', async () => {
		const held = { kind: 'held' } as const;
		const { run } = await runner({
			checks: [held, held, held, { kind: 'not_held', observed: 'text "Member Inquiry" not present in frame content' }],
		});
		const error = await failureOf(run.run(EVERY_KIND));
		expect(error).toMatchObject({
			code: 'checkpoint_failed',
			step: { index: 4, id: 's05-click' },
			expected: 'text "Member Inquiry" present in frame content',
			observed: 'text "Member Inquiry" not present in frame content',
		});
		const entries = await fixture.runLog.entries();
		expect(entries.at(-1)).toMatchObject({ kind: 'checkpoint', stepId: 's05-click', result: 'failed' });
	});

	it('an unresolved target is target_unresolved with the per-rung counts', async () => {
		const { run } = await runner({
			throwOnActCall: {
				call: 2,
				error: new TargetNotResolvedError('Member #', [
					{ index: 0, kind: 'structural', matches: 0 },
					{ index: 1, kind: 'structural', matches: 2 },
				]),
			},
		});
		expect(await failureOf(run.run(EVERY_KIND))).toMatchObject({
			code: 'target_unresolved',
			step: { index: 1, id: 's02-fill' },
			observed: 'rung 0 structural: 0 matches; rung 1 structural: 2 matches',
		});
	});

	it('without a session, an irreversible step without approval is approval_required (no request raised)', async () => {
		const { run } = await runner({
			throwOnActCall: {
				call: 5,
				error: new ApprovalRequiredError({ actionKind: 'click', reason: 'control Confirm', stepId: 's05-click' }),
			},
		});
		expect(await failureOf(run.run(EVERY_KIND))).toMatchObject({
			code: 'approval_required',
			step: { index: 4, id: 's05-click' },
		});
	});

	it('a wait that times out is checkpoint_failed with the wait condition as expected', async () => {
		const { run } = await runner({
			throwOnActCall: { call: 7, error: new WaitTimeoutError(2000, 'text "Balances" not present') },
		});
		expect(await failureOf(run.run(EVERY_KIND))).toMatchObject({
			code: 'checkpoint_failed',
			step: { index: 6, id: 's07-wait' },
			expected: 'text "Balances" present in frame content',
			observed: 'text "Balances" not present',
		});
	});

	it('pre-observe: a pending native dialog before a step that is not dismiss_dialog fails unknown_dialog without acting', async () => {
		const { run } = await runner({ pendingDialog: { type: 'alert', message: 'Member 12345 flagged' } });
		const error = await failureOf(run.run(EVERY_KIND));
		expect(error).toMatchObject({ code: 'unknown_dialog', step: { index: 0, id: 's01-navigate' } });
		expect(error.observed).not.toContain('12345');
		expect(fixture.surface.acts).toEqual([]);
	});

	it('an error that is not a run-level problem is rethrown, never swallowed', async () => {
		const bug = new RangeError('bug');
		const { run } = await runner({ throwOnActCall: { call: 1, error: bug } });
		await expect(run.run(EVERY_KIND)).rejects.toBe(bug);
	});

	it('a business-outcome rule scoped to a step: detected during its checkpoint → business_outcome, steps stop', async () => {
		const notFound: OutcomeRule = {
			code: 'member_not_found',
			class: 'business_outcome',
			description: 'No member has this number.',
			signature: { kind: 'text_present', text: 'No records match your search criteria', frame: content },
			scope: ['s05-click'],
		};
		const noRecords = fakeObservation(`${ORIGIN}/`, {
			frames: [
				{
					path: ['content'],
					name: 'content',
					url: `${ORIGIN}/member/detail`,
					title: 'CoreOne - Member Search',
					status: 200,
					text: 'Member Search No records match your search criteria for 12345',
					textTruncated: false,
				},
			],
		});
		const empty = fakeObservation(`${ORIGIN}/`);
		let searched = false;
		const { run } = await runner(
			// The message shows only after the s05 click; the first verifier poll of s05 sees it.
			{
				onAct: (action) => {
					if (action.stepId === 's05-click') searched = true;
					return undefined;
				},
			},
			{ conditions: { artifactRules: [notFound], profileRules: [] } },
		);
		fixture.surface.observe = async () => (searched ? noRecords : empty);
		expect(await run.run(EVERY_KIND)).toEqual({
			kind: 'business_outcome',
			code: 'member_not_found',
			message: 'No records match your search criteria',
			stepId: 's05-click',
		});
		expect(fixture.surface.acts.map((action) => action.stepId).at(-1)).toBe('s05-click');
		const entries = await fixture.runLog.entries();
		expect(entries.find((entry) => entry.kind === 'condition_detected')).toMatchObject({
			code: 'member_not_found',
			class: 'business_outcome',
			stepId: 's05-click',
		});
		expect(JSON.stringify(entries)).not.toContain('12345');
	});

	describe('failed-load retry (recovery guard)', () => {
		const failedLoad: OutcomeRule = {
			code: 'failed_load',
			class: 'recoverable',
			description: 'The page failed to load; retry.',
			signature: { kind: 'text_present', text: 'Service Unavailable' },
			scope: 'any_step',
			recovery: { kind: 'retry', max: 2, backoffMs: 0 },
		};
		const unavailable = fakeObservation(`${ORIGIN}/`, {
			frames: [
				{
					path: ['content'],
					name: 'content',
					url: `${ORIGIN}/member/detail`,
					title: 'Service Unavailable',
					status: 503,
					text: 'Service Unavailable HTTP Error 503',
					textTruncated: false,
				},
			],
		});
		const entry: Step = { ...base('s01-open'), kind: 'navigate', route: '/', checkpoint: textIn('Member Search') };
		const save: Step = {
			...base('s02-save', 'reversible'),
			kind: 'click',
			target: target('Save'),
			checkpoint: textIn('Saved'),
		};
		const search: Step = {
			...base('s03-search'),
			kind: 'click',
			target: target('Search'),
			checkpoint: textIn('Member Inquiry'),
		};

		/**
		 * A runner whose page shows "Service Unavailable" after the first act of `failAt` until the next navigate;
		 * `raised` step ids come back from the (simulated) guard classified irreversible; `savedBefore` makes the
		 * Saved checkpoint hold before s02 acted.
		 */
		async function retrying(options: { failAt: string; raised?: string[]; savedBefore?: boolean }) {
			let failing = false;
			let failed = false;
			let saved = options.savedBefore ?? false;
			const made = await runner(
				{
					onAct: (action) => {
						if (action.kind === 'navigate') failing = false;
						if (action.stepId === 's02-save') saved = true;
						if (action.stepId === options.failAt && !failed) {
							failed = true;
							failing = true;
						}
						return {
							kind: action.kind,
							url: `${ORIGIN}/`,
							navigation: null,
							...(options.raised?.includes(action.stepId ?? '') ? { risk: 'irreversible' as const } : {}),
						};
					},
				},
				{ conditions: { artifactRules: [failedLoad], profileRules: [] } },
			);
			fixture.surface.observe = async () => (failing ? unavailable : fakeObservation(`${ORIGIN}/`));
			const check: Surface['check'] = async (checkpoint) =>
				checkpoint.kind === 'text_present' && checkpoint.text === 'Saved' && !saved
					? { kind: 'not_held', observed: 'text "Saved" not present' }
					: { kind: 'held' };
			Object.assign(fixture.surface, { check });
			return made;
		}

		/** The step's own clicks (a reload's navigate carries the failed step's id too). */
		const actsOf = (stepId: string) =>
			fixture.surface.acts.filter((action) => action.stepId === stepId && action.kind === 'click').length;

		it('a step declared reversible that policy classified irreversible is never retried across', async () => {
			const { run, state } = await retrying({ failAt: 's03-search', raised: ['s02-save'] });
			const error = await failureOf(run.run([entry, save, search]));
			expect(error).toMatchObject({ code: 'recovery_exhausted', step: { index: 2, id: 's03-search' } });
			expect(error.observed).toBe('retrying would re-run the irreversible s02-save: refused');
			expect(state.effectiveRisk.get('s02-save')).toBe('irreversible');
			expect(actsOf('s02-save')).toBe(1);
			const entries = await fixture.runLog.entries();
			expect(entries.find((logged) => logged.kind === 'action' && logged.stepId === 's02-save')).toMatchObject({
				risk: 'irreversible',
			});
		});

		it('the failed step itself, raised to irreversible by policy, is never retried', async () => {
			const { run } = await retrying({ failAt: 's02-save', raised: ['s02-save'] });
			const error = await failureOf(run.run([entry, save, search]));
			expect(error).toMatchObject({ code: 'recovery_exhausted', step: { index: 1, id: 's02-save' } });
			expect(error.observed).toBe('failed_load after an irreversible step: it is never retried');
		});

		it('without the raise, the same run retries across s02 (control)', async () => {
			const { run } = await retrying({ failAt: 's03-search' });
			expect(await run.run([entry, save, search])).toEqual({ kind: 'completed' });
			// The retry ran: the entry route was reloaded for s03 (a read-only step whose checkpoint then held).
			expect(
				fixture.surface.acts.filter((action) => action.kind === 'navigate').map((action) => action.stepId),
			).toEqual(['s01-open', 's03-search']);
		});

		it('a checkpoint that already held before the step does not count the step as done after the reload', async () => {
			const { run } = await retrying({ failAt: 's02-save', savedBefore: true });
			expect(await run.run([entry, save, search])).toEqual({ kind: 'completed' });
			// Re-executed: the reload's "Saved" proves nothing, it held before s02 ever acted.
			expect(actsOf('s02-save')).toBe(2);
		});

		it('a checkpoint that did not hold before the step and holds after the reload counts the step as done', async () => {
			const { run } = await retrying({ failAt: 's02-save' });
			expect(await run.run([entry, save, search])).toEqual({ kind: 'completed' });
			expect(actsOf('s02-save')).toBe(1);
		});
	});
});
