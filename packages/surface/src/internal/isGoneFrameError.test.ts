import { describe, expect, it } from 'vitest';
import { isGoneFrameError } from './isGoneFrameError.js';

describe('isGoneFrameError', () => {
	it.each([
		'frame.evaluate: Execution context was destroyed, most likely because of a navigation',
		'Frame was detached',
		'locator.count: Frame has been detached.',
		'Protocol error (Runtime.callFunctionOn): Cannot find context with specified id',
		'Target page, context or browser has been closed',
	])('treats "%s" as a frame that went away', (message) => {
		expect(isGoneFrameError(new Error(message))).toBe(true);
	});

	it('treats anything else (and non-errors) as a real error', () => {
		expect(isGoneFrameError(new Error('Timeout 5000ms exceeded'))).toBe(false);
		expect(isGoneFrameError(new TypeError('x is not a function'))).toBe(false);
		expect(isGoneFrameError('Frame was detached')).toBe(false);
	});
});
