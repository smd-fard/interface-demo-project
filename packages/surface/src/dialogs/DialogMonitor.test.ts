import { describe, expect, it } from 'vitest';
import { DialogPendingError } from '../errors/DialogPendingError.js';
import { DialogMonitor } from './DialogMonitor.js';
import { fakeDialog, fakeDialogSource } from './fakeDialogs.test-helper.js';

describe('DialogMonitor', () => {
	it('holds an opened dialog as pending and never settles it on its own', () => {
		const page = fakeDialogSource();
		const monitor = new DialogMonitor(page);
		expect(monitor.current()).toBeNull();
		const confirm = fakeDialog('confirm', 'This action cannot be undone. Continue?');
		page.open(confirm.dialog);
		expect(monitor.current()).toEqual({ type: 'confirm', message: 'This action cannot be undone. Continue?' });
		expect(confirm.settledWith()).toBeNull();
	});

	it('assertNone throws DIALOG_PENDING with the type only while a dialog is open', () => {
		const page = fakeDialogSource();
		const monitor = new DialogMonitor(page);
		expect(() => monitor.assertNone('click')).not.toThrow();
		page.open(fakeDialog('alert', 'secret-ish text').dialog);
		const error = (() => {
			try {
				monitor.assertNone('click');
			} catch (caught) {
				return caught;
			}
			return undefined;
		})();
		expect(error).toBeInstanceOf(DialogPendingError);
		expect(error).toMatchObject({ code: 'DIALOG_PENDING', actionKind: 'click', dialogType: 'alert' });
		expect((error as Error).message).not.toContain('secret-ish');
	});

	it('settle accepts or dismisses the pending dialog once', async () => {
		const page = fakeDialogSource();
		const monitor = new DialogMonitor(page);
		expect(await monitor.settle('accept')).toBe(false);
		const alert = fakeDialog('alert', 'hi');
		page.open(alert.dialog);
		expect(await monitor.settle('dismiss')).toBe(true);
		expect(alert.settledWith()).toBe('dismiss');
		expect(monitor.current()).toBeNull();
		expect(await monitor.settle('accept')).toBe(false);
	});

	it('next() resolves with an already-pending dialog, or with the next one; cancel unsubscribes', async () => {
		const page = fakeDialogSource();
		const monitor = new DialogMonitor(page);
		const waiter = monitor.next();
		const cancelled = monitor.next();
		cancelled.cancel();
		page.open(fakeDialog('alert', 'one').dialog);
		await expect(waiter.promise).resolves.toEqual({ type: 'alert', message: 'one' });
		await expect(monitor.next().promise).resolves.toEqual({ type: 'alert', message: 'one' });
	});
});
