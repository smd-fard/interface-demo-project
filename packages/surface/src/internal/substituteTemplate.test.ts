import { describe, expect, it } from 'vitest';
import { BindingMissingError } from '../errors/BindingMissingError.js';
import { substituteTemplate } from './substituteTemplate.js';

describe('substituteTemplate', () => {
	it('returns plain text unchanged', () => {
		expect(substituteTemplate('Member Search', {})).toBe('Member Search');
	});

	it('substitutes every placeholder from the bindings', () => {
		expect(substituteTemplate('Member {{memberId}} of {{memberId}} / {{name}}', { memberId: '12345', name: 'x' })).toBe(
			'Member 12345 of 12345 / x',
		);
	});

	it('throws BindingMissingError naming the missing placeholder', () => {
		const error = (() => {
			try {
				substituteTemplate('Member {{memberId}}', {});
			} catch (caught) {
				return caught;
			}
			return undefined;
		})();
		expect(error).toBeInstanceOf(BindingMissingError);
		expect((error as BindingMissingError).code).toBe('BINDING_MISSING');
		expect((error as BindingMissingError).placeholder).toBe('memberId');
	});
});
