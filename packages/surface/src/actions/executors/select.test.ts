import { describe, expect, it } from 'vitest';
import { pickOption } from './select.js';

const options = [
	{ label: 'Holiday Club', value: 'HC' },
	{ label: 'Vacation  Savings', value: 'VS' },
];

describe('pickOption', () => {
	it('prefers the (normalized) label', () => {
		expect(pickOption(options, 'Vacation Savings')).toEqual({ label: 'Vacation  Savings', value: 'VS' });
	});

	it('falls back to the value', () => {
		expect(pickOption(options, 'HC')).toEqual({ label: 'Holiday Club', value: 'HC' });
	});

	it('returns undefined when neither matches', () => {
		expect(pickOption(options, 'Certificate')).toBeUndefined();
	});
});
