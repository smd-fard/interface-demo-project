import type { ActOutcome } from '../../port/ActOutcome.js';
import type { PendingDialog } from '../../port/PendingDialog.js';
import type { SurfaceActionOf } from '../../port/SurfaceAction.js';
import type { ActionContext } from '../ActionContext.js';
import { actAndSettle } from '../actAndSettle.js';
import type { DialogHandler } from '../raceDialogs.js';

/**
 * Clicks the target and waits for the frames to load. A dialog the click raises is reported in
 * `ActOutcome.dialog` and left pending, with one exception: when the action carries an approval grant, the
 * `confirm` raised by this click itself (while the click is still in flight) is accepted as part of the
 * approved action and reported in `acceptedDialog`. The grant is validated by the policy guard, not here.
 */
export async function executeClick(context: ActionContext, action: SurfaceActionOf<'click'>): Promise<ActOutcome> {
	const resolved = await context.resolveTarget(action.target, action.bindings ?? {});
	let clickInFlight = true;
	let accepted: PendingDialog | undefined;
	const onDialog: DialogHandler | undefined =
		action.approvalGrant === undefined
			? undefined
			: async (dialog) => {
					if (!clickInFlight || accepted !== undefined || dialog.type !== 'confirm') return false;
					accepted = dialog;
					await context.dialogs.settle('accept');
					return true;
				};
	return actAndSettle(
		context,
		action,
		async () => {
			try {
				await resolved.locator.click(action.timeoutMs === undefined ? {} : { timeout: action.timeoutMs });
			} finally {
				clickInFlight = false;
			}
		},
		{
			extras: () => ({
				...(resolved.resolution === undefined ? {} : { resolution: resolved.resolution }),
				...(accepted === undefined ? {} : { acceptedDialog: accepted }),
			}),
			...(onDialog === undefined ? {} : { onDialog }),
		},
	);
}
