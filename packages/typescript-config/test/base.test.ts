import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface TsConfig {
	compilerOptions?: Record<string, unknown>;
}

const baseUrl = new URL('../base.json', import.meta.url);

function loadBase(): TsConfig {
	return JSON.parse(readFileSync(baseUrl, 'utf8')) as TsConfig;
}

describe('base.json', () => {
	const options = loadBase().compilerOptions ?? {};

	it('is strict', () => {
		expect(options['strict']).toBe(true);
		expect(options['noUncheckedIndexedAccess']).toBe(true);
	});

	it('uses NodeNext module and resolution', () => {
		expect(options['module']).toBe('NodeNext');
		expect(options['moduleResolution']).toBe('NodeNext');
	});

	it('enables verbatimModuleSyntax', () => {
		expect(options['verbatimModuleSyntax']).toBe(true);
	});

	it('includes node types (TS 6 defaults types to [])', () => {
		expect(options['types']).toEqual(expect.arrayContaining(['node']));
	});

	it('never sets baseUrl or paths (deprecated in TS 6)', () => {
		expect(options).not.toHaveProperty('baseUrl');
		expect(options).not.toHaveProperty('paths');
	});
});
