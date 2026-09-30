import { describe, expect, it } from 'vitest';
import { ReplayOptionsError } from './errors/ReplayOptionsError.js';
import { DEFAULT_REPLAY_OPTIONS, resolveReplayOptions } from './ReplayOptions.js';

describe('resolveReplayOptions', () => {
	it('defaults: unattended, 10 s steps and checkpoints, 15 s slow-load budget, 2 retries, 1 dismiss, 1 re-auth', () => {
		expect(resolveReplayOptions()).toEqual({
			attended: false,
			stepTimeoutMs: 10_000,
			checkpointTimeoutMs: 10_000,
			slowLoadBudgetMs: 15_000,
			retry: { max: 2, backoffMs: 500 },
			maxDialogDismissPerStep: 1,
			maxReauthPerRun: 1,
			approvalTimeoutMs: 300_000,
		});
		expect(resolveReplayOptions()).toEqual(DEFAULT_REPLAY_OPTIONS);
	});

	it('merges overrides, including a partial retry', () => {
		expect(resolveReplayOptions({ attended: true, stepTimeoutMs: 500, retry: { max: 0 } })).toMatchObject({
			attended: true,
			stepTimeoutMs: 500,
			retry: { max: 0, backoffMs: 500 },
		});
	});

	it('rejects values outside their bounds with a typed error', () => {
		expect(() => resolveReplayOptions({ stepTimeoutMs: 0 })).toThrow(ReplayOptionsError);
		expect(() => resolveReplayOptions({ retry: { max: 50 } })).toThrow(ReplayOptionsError);
		expect(() => resolveReplayOptions({ checkpointTimeoutMs: 1.5 })).toThrow(ReplayOptionsError);
		expect(() => resolveReplayOptions({ maxReauthPerRun: -1 })).toThrow(/maxReauthPerRun/);
	});
});
