import { TargetRefSchema } from '@idp/artifact-schema';
import { describe, expect, it } from 'vitest';
import { fakeFingerprint } from '../testing/FakeSurface.js';
import { targetFromFingerprint } from './targetFromFingerprint.js';

describe('targetFromFingerprint', () => {
	it('a named button: role rung first, then its container position; a valid TargetRef', () => {
		const target = targetFromFingerprint(
			fakeFingerprint({ container: { element: 'button', index: 0, containerText: 'Member Search' } }),
		);
		expect(TargetRefSchema.parse(target)).toEqual(target);
		expect(target?.frame).toEqual([{ kind: 'by_name', name: 'content' }]);
		expect(target?.ladder[0]).toMatchObject({ kind: 'role', role: 'button', name: 'Search', exact: true });
		expect(target?.ladder[1]).toMatchObject({
			kind: 'structural',
			anchor: { kind: 'nth_in_container', element: 'button', index: 0, containerText: 'Member Search' },
		});
	});

	it('an unnamed input labelled by a cell: form_row first', () => {
		const target = targetFromFingerprint(
			fakeFingerprint({
				role: 'textbox',
				name: '',
				labelCellText: 'Member #',
				container: { element: 'input', index: 0, containerText: null },
			}),
		);
		expect(TargetRefSchema.safeParse(target).success).toBe(true);
		expect(target?.ladder[0]).toMatchObject({
			kind: 'structural',
			anchor: { kind: 'form_row', labelText: 'Member #', control: 'input' },
		});
	});

	it('returns null when nothing identifies the element', () => {
		expect(
			targetFromFingerprint(
				fakeFingerprint({ role: null, name: '', visibleText: '', container: null, labelCellText: null }),
			),
		).toBeNull();
	});
});
