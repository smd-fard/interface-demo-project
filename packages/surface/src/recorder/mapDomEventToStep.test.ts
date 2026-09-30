import { describe, expect, it } from 'vitest';
import { fakeFingerprint } from '../testing/FakeSurface.js';
import { mapDomEventToStep } from './mapDomEventToStep.js';

const button = fakeFingerprint();
const input = fakeFingerprint({
	role: 'textbox',
	name: '',
	tag: 'input',
	inputType: 'text',
	labelCellText: 'Member #',
});
const base = { token: 't1', inputType: null } as const;

describe('mapDomEventToStep', () => {
	it('a click on a button or link is a click', () => {
		expect(mapDomEventToStep({ ...base, event: 'click', tag: 'input', inputType: 'submit' }, button)).toEqual({
			kind: 'click',
			fingerprint: button,
			sensitive: false,
		});
		expect(mapDomEventToStep({ ...base, event: 'click', tag: 'a' }, button)?.kind).toBe('click');
	});

	it('a submit is a click on its submitter; a submit without one is not mapped', () => {
		expect(mapDomEventToStep({ ...base, event: 'submit', tag: 'button' }, button)?.kind).toBe('click');
		expect(mapDomEventToStep({ ...base, event: 'submit', tag: 'form' }, button)).toBeNull();
	});

	it('Enter is a press on the focused element; other keys are not mapped', () => {
		expect(
			mapDomEventToStep({ ...base, event: 'keydown', tag: 'input', inputType: 'text', key: 'Enter' }, input),
		).toEqual({
			kind: 'press',
			fingerprint: input,
			value: 'Enter',
			sensitive: false,
		});
		expect(
			mapDomEventToStep({ ...base, event: 'keydown', tag: 'input', inputType: 'text', key: 'a' }, input),
		).toBeNull();
	});

	it('a change on a text field is a fill whose value is marked sensitive', () => {
		for (const inputType of ['text', 'password', 'number', 'email']) {
			expect(mapDomEventToStep({ ...base, event: 'change', tag: 'input', inputType, value: '12345' }, input)).toEqual({
				kind: 'fill',
				fingerprint: input,
				value: '12345',
				sensitive: true,
			});
		}
		expect(mapDomEventToStep({ ...base, event: 'change', tag: 'textarea', value: 'note' }, input)).toMatchObject({
			kind: 'fill',
			sensitive: true,
		});
	});

	it('a change on a select is a select of the option label', () => {
		expect(
			mapDomEventToStep({ ...base, event: 'change', tag: 'select', optionLabel: 'Vacation Savings' }, input),
		).toEqual({ kind: 'select', fingerprint: input, value: 'Vacation Savings', sensitive: false });
	});

	it('changes that a click already covers (checkbox, radio) or that carry no value are not mapped', () => {
		expect(mapDomEventToStep({ ...base, event: 'change', tag: 'input', inputType: 'checkbox' }, input)).toBeNull();
		expect(mapDomEventToStep({ ...base, event: 'change', tag: 'input', inputType: 'radio' }, input)).toBeNull();
		expect(mapDomEventToStep({ ...base, event: 'change', tag: 'input', inputType: 'file' }, input)).toBeNull();
		expect(mapDomEventToStep({ ...base, event: 'change', tag: 'input', inputType: 'text' }, input)).toBeNull();
		expect(mapDomEventToStep({ ...base, event: 'change', tag: 'select' }, input)).toBeNull();
	});
});
