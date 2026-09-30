import { describe, expect, it } from 'vitest';
import { FaultSwitch } from './FaultSwitch.js';

describe('FaultSwitch', () => {
	it('fires nothing when nothing is armed', () => {
		expect(new FaultSwitch().take('app_error', '/member/detail')).toBeUndefined();
	});

	it('fires a once fault exactly once on its default route', () => {
		const faults = new FaultSwitch();
		faults.arm({ code: 'known_dialog', mode: 'once' });
		expect(faults.take('known_dialog', '/member/search')).toBeUndefined();
		expect(faults.take('known_dialog', '/member/detail')).toEqual({ code: 'known_dialog', mode: 'once' });
		expect(faults.take('known_dialog', '/member/detail')).toBeUndefined();
	});

	it('keeps an always fault armed and counts firings', () => {
		const faults = new FaultSwitch();
		faults.arm({ code: 'app_error', mode: 'always' });
		expect(faults.take('app_error', '/member/search')).toBeDefined();
		expect(faults.take('app_error', '/subaccount/open')).toBeDefined();
		expect(faults.list()).toEqual([{ code: 'app_error', mode: 'always', fired: 2 }]);
	});

	it('uses an explicit route instead of the defaults', () => {
		const faults = new FaultSwitch();
		faults.arm({ code: 'app_error', mode: 'once', route: '/login' });
		expect(faults.take('app_error', '/member/search')).toBeUndefined();
		expect(faults.take('app_error', '/login')).toBeDefined();
	});

	it('keeps the per-fault delay', () => {
		const faults = new FaultSwitch();
		faults.arm({ code: 'slow_load', mode: 'once', delayMs: 250 });
		expect(faults.take('slow_load', '/member/search')?.delayMs).toBe(250);
	});

	it('clears everything, and reset re-arms the start-up set', () => {
		const faults = new FaultSwitch([{ code: 'control_missing', mode: 'once' }]);
		faults.arm({ code: 'app_error', mode: 'always' });
		faults.clear();
		expect(faults.list()).toEqual([]);
		faults.reset();
		expect(faults.list()).toEqual([{ code: 'control_missing', mode: 'once', fired: 0 }]);
	});
});
