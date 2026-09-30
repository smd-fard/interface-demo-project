import { describe, expect, it } from 'vitest';
import { DialogMonitor } from '../dialogs/DialogMonitor.js';
import { fakeDialog, fakeDialogSource } from '../dialogs/fakeDialogs.test-helper.js';
import { raceDialogs } from './raceDialogs.js';

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe('raceDialogs', () => {
	it('returns null when the work finishes without a dialog', async () => {
		const monitor = new DialogMonitor(fakeDialogSource());
		await expect(raceDialogs(monitor, async () => undefined)).resolves.toBeNull();
	});

	it('returns the dialog promptly while the work is still blocked by it', async () => {
		const page = fakeDialogSource();
		const monitor = new DialogMonitor(page);
		const blocked = deferred();
		const result = raceDialogs(monitor, async () => {
			page.open(fakeDialog('confirm', 'Continue?').dialog);
			await blocked.promise;
		});
		await expect(result).resolves.toEqual({ type: 'confirm', message: 'Continue?' });
		blocked.reject(new Error('abandoned work fails later')); // must not surface as an unhandled rejection
	});

	it('keeps waiting after a handled dialog and returns null when the work then finishes', async () => {
		const page = fakeDialogSource();
		const monitor = new DialogMonitor(page);
		const confirm = fakeDialog('confirm', 'Continue?');
		const release = deferred();
		const seen: string[] = [];
		const result = await raceDialogs(
			monitor,
			async () => {
				page.open(confirm.dialog);
				await release.promise;
			},
			async (dialog) => {
				seen.push(dialog.type);
				await monitor.settle('accept');
				release.resolve();
				return true;
			},
		);
		expect(result).toBeNull();
		expect(seen).toEqual(['confirm']);
		expect(confirm.settledWith()).toBe('accept');
	});

	it('leaves a dialog pending when the handler declines it', async () => {
		const page = fakeDialogSource();
		const monitor = new DialogMonitor(page);
		const alert = fakeDialog('alert', 'Maintenance');
		const result = await raceDialogs(
			monitor,
			async () => {
				page.open(alert.dialog);
				await new Promise(() => undefined);
			},
			async () => false,
		);
		expect(result).toEqual({ type: 'alert', message: 'Maintenance' });
		expect(alert.settledWith()).toBeNull();
		expect(monitor.current()).not.toBeNull();
	});

	it('propagates a work error', async () => {
		const monitor = new DialogMonitor(fakeDialogSource());
		await expect(
			raceDialogs(monitor, async () => {
				throw new Error('boom');
			}),
		).rejects.toThrow('boom');
	});
});
