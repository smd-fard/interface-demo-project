import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import type { Linter } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const TIMEOUT = 60_000;

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
let eslint: ESLint;

async function lint(code: string, file: string): Promise<Linter.LintMessage[]> {
	const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, file) });
	if (result === undefined) {
		throw new Error(`no lint result for ${file}`);
	}
	return result.messages;
}

function expectSingleError(messages: Linter.LintMessage[], ruleId: string, contains: string): void {
	expect(messages).toHaveLength(1);
	const [message] = messages;
	expect(message?.ruleId).toBe(ruleId);
	expect(message?.severity).toBe(2);
	expect(message?.message).toContain(contains);
}

describe('ESLint source boundaries (AC6)', () => {
	beforeAll(() => {
		eslint = new ESLint({ cwd: repoRoot });
	}, TIMEOUT);

	it(
		'rejects @idp/agent imported from @idp/replay-engine (BND001)',
		async () => {
			const messages = await lint(
				"import { a } from '@idp/agent';\nexport { a };\n",
				'packages/replay-engine/src/x.ts',
			);
			expectSingleError(messages, 'no-restricted-imports', 'BND001');
		},
		TIMEOUT,
	);

	it(
		'allows @idp/session imported from @idp/replay-engine',
		async () => {
			const messages = await lint(
				"import { a } from '@idp/session';\nexport { a };\n",
				'packages/replay-engine/src/x.ts',
			);
			expect(messages).toEqual([]);
		},
		TIMEOUT,
	);

	it(
		'rejects `import type` from a forbidden package',
		async () => {
			const messages = await lint(
				"import type { A } from '@idp/agent';\nexport type { A };\n",
				'packages/replay-engine/src/x.ts',
			);
			expectSingleError(messages, 'no-restricted-imports', 'BND001');
		},
		TIMEOUT,
	);

	it(
		'rejects playwright outside @idp/surface (BND004)',
		async () => {
			const messages = await lint(
				"import { chromium } from 'playwright';\nexport { chromium };\n",
				'packages/policy/src/x.ts',
			);
			expectSingleError(messages, 'no-restricted-imports', 'BND004');
		},
		TIMEOUT,
	);

	it(
		'allows playwright inside @idp/surface',
		async () => {
			const messages = await lint(
				"import { chromium } from 'playwright';\nexport { chromium };\n",
				'packages/surface/src/x.ts',
			);
			expect(messages).toEqual([]);
		},
		TIMEOUT,
	);

	it(
		'rejects @anthropic-ai/sdk outside @idp/agent (BND005)',
		async () => {
			const messages = await lint(
				"import Anthropic from '@anthropic-ai/sdk';\nexport { Anthropic };\n",
				'packages/surface/src/x.ts',
			);
			expectSingleError(messages, 'no-restricted-imports', 'BND005');
		},
		TIMEOUT,
	);

	it(
		'rejects any @idp/* import from @idp/mock-bank (BND003)',
		async () => {
			const messages = await lint("import { a } from '@idp/policy';\nexport { a };\n", 'apps/mock-bank/src/x.ts');
			expectSingleError(messages, 'no-restricted-imports', 'BND003');
		},
		TIMEOUT,
	);

	it(
		'rejects importing @idp/mock-bank from @idp/cli (BND003)',
		async () => {
			const messages = await lint("import { a } from '@idp/mock-bank';\nexport { a };\n", 'apps/cli/src/x.ts');
			expectSingleError(messages, 'no-restricted-imports', 'BND003');
		},
		TIMEOUT,
	);

	it(
		'rejects a relative import into a sibling workspace',
		async () => {
			const messages = await lint(
				"import { a } from '../../agent/src/index.js';\nexport { a };\n",
				'packages/replay-engine/src/x.ts',
			);
			expectSingleError(messages, 'idp/no-relative-cross-workspace', 'packages/replay-engine');
		},
		TIMEOUT,
	);

	it(
		'allows a relative import that stays inside its own workspace',
		async () => {
			const messages = await lint(
				"import { a } from '../test/helpers.js';\nexport { a };\n",
				'packages/replay-engine/src/x.ts',
			);
			expect(messages).toEqual([]);
		},
		TIMEOUT,
	);
});
