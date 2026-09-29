import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

function findRepoRoot(start: string): string {
	let dir = start;
	while (!existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
		const parent = path.dirname(dir);
		if (parent === dir) {
			throw new Error(`pnpm-workspace.yaml not found above ${start}`);
		}
		dir = parent;
	}
	return dir;
}

const repoRoot = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const envExample = path.join(repoRoot, '.env.example');

function checkIgnore(file: string): number | null {
	const result = spawnSync('git', ['check-ignore', '-q', file], { cwd: repoRoot });
	if (result.error !== undefined) {
		throw result.error;
	}
	return result.status;
}

describe('repository hygiene (AC7)', () => {
	it('.env.example exists and declares only keys with empty values', () => {
		expect(existsSync(envExample)).toBe(true);
		const entries = readFileSync(envExample, 'utf8')
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0 && !line.startsWith('#'));
		expect(entries.length).toBeGreaterThan(0);
		for (const line of entries) {
			expect(line).toMatch(/^[A-Z][A-Z0-9_]*=$/);
		}
	});

	it('.env is ignored by git', () => {
		expect(checkIgnore('.env')).toBe(0);
	});

	it('.env.example is not ignored by git', () => {
		expect(checkIgnore('.env.example')).toBe(1);
	});
});
