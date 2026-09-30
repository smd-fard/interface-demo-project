import { describe, expect, it } from 'vitest';
import { attendedWarning } from './attendedWarning.js';

describe('attendedWarning', () => {
	it('warns when attended runs headless: only approval/abort are possible, a takeover needs --headed', () => {
		const warning = attendedWarning({ attended: true, headed: false });
		expect(warning).toContain('--headed');
		expect(warning).toContain('approve, reject or abort');
		expect(warning).toContain('cannot take over');
	});

	it.each([
		{ attended: true, headed: true },
		{ attended: false, headed: false },
		{ attended: false, headed: true },
	])('is silent otherwise (%o)', (flags) => {
		expect(attendedWarning(flags)).toBeNull();
	});
});
