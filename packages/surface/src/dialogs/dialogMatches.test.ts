import { describe, expect, it } from 'vitest';
import { dialogMatches } from './dialogMatches.js';

describe('dialogMatches', () => {
	it('matches a normalized substring of the message', () => {
		expect(dialogMatches('Scheduled maintenance tonight at 11 PM', 'Scheduled maintenance')).toBe(true);
		expect(dialogMatches('Scheduled  maintenance\n tonight', '  Scheduled   maintenance ')).toBe(true);
	});

	it('is case-sensitive and rejects other text', () => {
		expect(dialogMatches('Scheduled maintenance tonight', 'scheduled maintenance')).toBe(false);
		expect(dialogMatches('Printer queue PRN-07 is offline. Retry?', 'Scheduled maintenance')).toBe(false);
	});

	it('never matches an empty or whitespace-only pattern', () => {
		expect(dialogMatches('anything', '')).toBe(false);
		expect(dialogMatches('anything', '   ')).toBe(false);
	});
});
