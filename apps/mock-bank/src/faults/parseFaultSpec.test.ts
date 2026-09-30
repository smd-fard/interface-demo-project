import { describe, expect, it } from 'vitest';
import { FaultSpecError } from '../errors/FaultSpecError.js';
import { parseFaultList, parseFaultSpec } from './parseFaultSpec.js';

describe('parseFaultSpec', () => {
	it('fills the default mode per code', () => {
		expect(parseFaultSpec({ code: 'failed_load' })).toEqual({ code: 'failed_load', mode: 'once' });
		expect(parseFaultSpec({ code: 'failed_load_persistent' })).toEqual({
			code: 'failed_load_persistent',
			mode: 'always',
		});
	});

	it('keeps mode, route and delayMs', () => {
		expect(parseFaultSpec({ code: 'slow_load', mode: 'always', route: '/member/*', delayMs: 50 })).toEqual({
			code: 'slow_load',
			mode: 'always',
			route: '/member/*',
			delayMs: 50,
		});
	});

	it.each([
		[null],
		[{ code: 'meteor_strike' }],
		[{ code: 'app_error', mode: 'sometimes' }],
		[{ code: 'app_error', route: 'member' }],
		[{ code: 'slow_load', delayMs: -1 }],
	])('rejects %j with a typed error', (input) => {
		expect(() => parseFaultSpec(input)).toThrow(FaultSpecError);
	});
});

describe('parseFaultList', () => {
	it('treats empty or absent as no faults', () => {
		expect(parseFaultList(undefined)).toEqual([]);
		expect(parseFaultList('  ')).toEqual([]);
	});

	it('parses code[:mode][@route] entries', () => {
		expect(parseFaultList('app_error@/member/detail, known_dialog:always,session_timeout')).toEqual([
			{ code: 'app_error', mode: 'once', route: '/member/detail' },
			{ code: 'known_dialog', mode: 'always' },
			{ code: 'session_timeout', mode: 'once' },
		]);
	});

	it('rejects a malformed entry', () => {
		expect(() => parseFaultList('app_error:never')).toThrow(FaultSpecError);
		expect(() => parseFaultList('App Error')).toThrow(FaultSpecError);
	});
});
