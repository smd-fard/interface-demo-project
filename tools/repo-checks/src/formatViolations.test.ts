import { describe, expect, it } from 'vitest';

import type { BoundaryViolation } from './BoundaryViolation.js';
import { formatViolations } from './formatViolations.js';

const violations: BoundaryViolation[] = [
	{
		code: 'BND001',
		rule: 'layer-direction',
		package: '@idp/policy',
		dependency: '@idp/evidence',
		section: 'dependencies',
		path: ['@idp/policy', '@idp/evidence'],
		message: 'rank 2 is not left of rank 1',
	},
	{
		code: 'BND002',
		rule: 'cycle',
		package: '@idp/a',
		dependency: '@idp/b',
		section: null,
		path: ['@idp/a', '@idp/b', '@idp/a'],
		message: 'cycle @idp/a → @idp/b → @idp/a',
	},
];

describe('formatViolations', () => {
	it('renders one line per violation with code, rule, package, dependency and section', () => {
		const lines = formatViolations(violations).split('\n');
		expect(lines).toHaveLength(2);
		expect(lines[0]).toBe(
			'BND001 layer-direction: @idp/policy → @idp/evidence (dependencies) — rank 2 is not left of rank 1',
		);
		for (const [i, v] of violations.entries()) {
			const line = lines[i] ?? '';
			for (const part of [v.code, v.rule, v.package, v.dependency, v.message]) {
				expect(line).toContain(part);
			}
		}
		expect(lines[1]).toContain('(-)');
	});

	it('renders an empty string for no violations', () => {
		expect(formatViolations([])).toBe('');
	});
});
