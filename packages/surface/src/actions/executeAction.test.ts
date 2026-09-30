import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { DialogMonitor } from '../dialogs/DialogMonitor.js';
import { fakeDialog, fakeDialogSource } from '../dialogs/fakeDialogs.test-helper.js';
import { ActionFailedError } from '../errors/ActionFailedError.js';
import { DialogMismatchError } from '../errors/DialogMismatchError.js';
import { DialogPendingError } from '../errors/DialogPendingError.js';
import { NoDialogPendingError } from '../errors/NoDialogPendingError.js';
import { TargetNotResolvedError } from '../errors/TargetNotResolvedError.js';
import { WaitTimeoutError } from '../errors/WaitTimeoutError.js';
import type { CheckResult } from '../port/CheckResult.js';
import type { SurfaceAction } from '../port/SurfaceAction.js';
import type { ActionContext } from './ActionContext.js';
import { executeAction } from './executeAction.js';

const actor = 'replay' as const;
const target = { kind: 'ref' as const, ref: 'e1' };
const until = { kind: 'text_present' as const, text: 'Member Inquiry' };

/** A context whose browser side is never reached unless a test says so. */
function fakeContext(overrides: Partial<ActionContext> = {}) {
	const page = fakeDialogSource();
	const dialogs = new DialogMonitor(page);
	let checkResult: CheckResult = { kind: 'held' };
	const touched: string[] = [];
	const context: ActionContext = {
		page: {
			url: () => 'http://127.0.0.1:4010/',
			waitForLoadState: async () => undefined,
			frames: () => [],
		} as unknown as Page,
		origin: 'http://127.0.0.1:4010',
		dialogs,
		navigation: { lastNavigation: () => null, loadCount: () => 0, isQuiet: () => true, now: () => 0 },
		resolveTarget: async () => {
			touched.push('resolveTarget');
			throw new Error('not reached');
		},
		check: async () => {
			touched.push('check');
			return checkResult;
		},
		...overrides,
	};
	return {
		context,
		page,
		touched,
		setCheck: (result: CheckResult) => {
			checkResult = result;
		},
	};
}

const everyKindButDismiss: SurfaceAction[] = [
	{ kind: 'navigate', actor, route: '/' },
	{ kind: 'click', actor, target },
	{ kind: 'fill', actor, target, value: 'x', sensitive: true },
	{ kind: 'select', actor, target, option: 'Holiday Club' },
	{ kind: 'press', actor, key: 'Enter' },
	{ kind: 'extract', actor, target },
	{ kind: 'wait', actor, until, timeoutMs: 100 },
];

describe('executeAction', () => {
	it.each(everyKindButDismiss.map((action) => [action.kind, action] as const))(
		'%s fails fast with DialogPendingError while a dialog is open, touching nothing',
		async (_kind, action) => {
			const { context, page, touched } = fakeContext();
			page.open(fakeDialog('alert', 'Scheduled maintenance').dialog);
			await expect(executeAction(context, action)).rejects.toBeInstanceOf(DialogPendingError);
			expect(touched).toEqual([]);
		},
	);

	it('wait returns an outcome when the checkpoint holds', async () => {
		const { context } = fakeContext();
		await expect(executeAction(context, { kind: 'wait', actor, until, timeoutMs: 100 })).resolves.toEqual({
			kind: 'wait',
			url: 'http://127.0.0.1:4010/',
			navigation: null,
		});
	});

	it('wait throws WAIT_TIMEOUT with the observed detail when the checkpoint never holds', async () => {
		const { context, setCheck } = fakeContext();
		setCheck({ kind: 'not_held', observed: 'text "Member Inquiry" not present in any frame' });
		const error = await executeAction(context, { kind: 'wait', actor, until, timeoutMs: 100 }).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(WaitTimeoutError);
		expect(error).toMatchObject({
			code: 'WAIT_TIMEOUT',
			timeoutMs: 100,
			observed: 'text "Member Inquiry" not present in any frame',
		});
	});

	it('dismiss_dialog without an open dialog throws NO_DIALOG_PENDING', async () => {
		const { context } = fakeContext();
		await expect(
			executeAction(context, { kind: 'dismiss_dialog', actor, match: 'Scheduled', action: 'accept' }),
		).rejects.toBeInstanceOf(NoDialogPendingError);
	});

	it('dismiss_dialog leaves a non-matching dialog open (DIALOG_MISMATCH, message kept out of .message)', async () => {
		const { context, page } = fakeContext();
		const confirm = fakeDialog('confirm', 'Printer queue PRN-07 is offline. Retry?');
		page.open(confirm.dialog);
		const error = await executeAction(context, {
			kind: 'dismiss_dialog',
			actor,
			match: 'Scheduled maintenance',
			action: 'accept',
		}).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(DialogMismatchError);
		expect(error).toMatchObject({ code: 'DIALOG_MISMATCH', dialogType: 'confirm' });
		expect((error as Error).message).not.toContain('Printer');
		expect(confirm.settledWith()).toBeNull();
		expect(context.dialogs.current()).not.toBeNull();
	});

	it('dismiss_dialog settles a matching dialog with the requested action', async () => {
		const { context, page } = fakeContext();
		const alert = fakeDialog('alert', 'Scheduled maintenance tonight at 11 PM');
		page.open(alert.dialog);
		const outcome = await executeAction(context, {
			kind: 'dismiss_dialog',
			actor,
			match: 'Scheduled maintenance',
			action: 'dismiss',
		});
		expect(outcome).toEqual({ kind: 'dismiss_dialog', url: 'http://127.0.0.1:4010/', navigation: null });
		expect(alert.settledWith()).toBe('dismiss');
		expect(context.dialogs.current()).toBeNull();
	});

	it('passes typed surface errors through unchanged', async () => {
		const unresolved = new TargetNotResolvedError('Search button', [{ index: 0, kind: 'role', matches: 0 }]);
		const { context } = fakeContext({
			resolveTarget: async () => {
				throw unresolved;
			},
		});
		await expect(executeAction(context, { kind: 'click', actor, target })).rejects.toBe(unresolved);
	});

	it('wraps a browser error in ACTION_FAILED without echoing its message', async () => {
		const timeout = Object.assign(new Error('locator.fill: Timeout exceeded waiting for txt1=12345'), {
			name: 'TimeoutError',
		});
		const { context } = fakeContext({
			resolveTarget: async () => {
				throw timeout;
			},
		});
		const error = await executeAction(context, { kind: 'fill', actor, target, value: '12345', sensitive: true }).catch(
			(e: unknown) => e,
		);
		expect(error).toBeInstanceOf(ActionFailedError);
		expect(error).toMatchObject({ code: 'ACTION_FAILED', actionKind: 'fill', reason: 'timeout', cause: timeout });
		expect((error as Error).message).not.toContain('12345');
	});
});
