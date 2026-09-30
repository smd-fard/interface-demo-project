import { describe, expect, it } from 'vitest';
import { normalizeText } from './normalizeText.js';

describe('normalizeText', () => {
	it('collapses whitespace including non-breaking spaces and trims', () => {
		expect(normalizeText('  Share Savings \n\t 1523.47 ')).toBe('Share Savings 1523.47');
	});
});
