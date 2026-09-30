import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot, parseListeningLine } from './launchMockBank.js';

describe('parseListeningLine', () => {
	it('extracts the origin from the mock-bank start line', () => {
		expect(parseListeningLine('listening http://127.0.0.1:53211')).toBe('http://127.0.0.1:53211');
		expect(parseListeningLine('mock-bank listening http://127.0.0.1:4010/ (tenant a)')).toBe('http://127.0.0.1:4010');
	});
	it('ignores any other line', () => {
		expect(parseListeningLine('starting…')).toBeNull();
		expect(parseListeningLine('listening soon')).toBeNull();
	});
});

describe('findRepoRoot', () => {
	it('walks up to the directory holding pnpm-workspace.yaml', () => {
		const root = findRepoRoot(import.meta.url);
		expect(existsSync(path.join(root, 'pnpm-workspace.yaml'))).toBe(true);
		expect(existsSync(path.join(root, 'apps', 'mock-bank', 'package.json'))).toBe(true);
	});
});
