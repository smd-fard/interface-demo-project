import type { Dialog } from 'playwright';
import type { DialogSource } from './DialogMonitor.js';

/** A fake native dialog that records how it was settled. */
export interface FakeDialog {
	readonly dialog: Dialog;
	settledWith(): 'accept' | 'dismiss' | null;
}

export function fakeDialog(type: string, message: string): FakeDialog {
	let settled: 'accept' | 'dismiss' | null = null;
	const dialog = {
		type: () => type,
		message: () => message,
		accept: async () => {
			settled = 'accept';
		},
		dismiss: async () => {
			settled = 'dismiss';
		},
	} as unknown as Dialog;
	return { dialog, settledWith: () => settled };
}

/** A fake page that lets a test open dialogs. */
export function fakeDialogSource(): DialogSource & { open(dialog: Dialog): void } {
	const listeners: ((dialog: Dialog) => void)[] = [];
	return {
		on: (_event, listener) => {
			listeners.push(listener);
		},
		open: (dialog) => {
			for (const listener of listeners) listener(dialog);
		},
	};
}
