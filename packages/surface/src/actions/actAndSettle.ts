import { waitForFramesLoaded } from '../playwright/waitForFramesLoaded.js';
import type { ActOutcome } from '../port/ActOutcome.js';
import type { PendingDialog } from '../port/PendingDialog.js';
import type { Resolution } from '../port/Resolution.js';
import type { SurfaceAction } from '../port/SurfaceAction.js';
import type { ActionContext } from './ActionContext.js';
import { raceDialogs, type DialogHandler } from './raceDialogs.js';

/** Extra outcome fields an executor contributes. */
export interface OutcomeExtras {
	readonly resolution?: Resolution;
	readonly extracted?: string;
	readonly acceptedDialog?: PendingDialog;
}

/** Builds the outcome: landing URL, the latest load when one happened since `loadsBefore`, and the extras. */
export function buildOutcome(
	context: ActionContext,
	action: SurfaceAction,
	loadsBefore: number,
	extras: OutcomeExtras & { readonly dialog?: PendingDialog | null } = {},
): ActOutcome {
	const { dialog, ...rest } = extras;
	const navigation = context.navigation.loadCount() > loadsBefore ? context.navigation.lastNavigation() : null;
	return {
		kind: action.kind,
		url: context.page.url(),
		navigation,
		...(rest.resolution === undefined ? {} : { resolution: rest.resolution }),
		...(rest.extracted === undefined ? {} : { extracted: rest.extracted }),
		...(rest.acceptedDialog === undefined ? {} : { acceptedDialog: rest.acceptedDialog }),
		...(dialog === undefined || dialog === null ? {} : { dialog }),
	};
}

/**
 * Performs a gesture, then waits for every frame to finish loading, racing both against native dialogs.
 * Returns the outcome; a dialog left open is reported in `dialog` rather than hanging the call.
 */
export async function actAndSettle(
	context: ActionContext,
	action: SurfaceAction,
	gesture: () => Promise<void>,
	options: {
		readonly extras?: () => OutcomeExtras;
		readonly onDialog?: DialogHandler;
		/** The load count before the action began, when it began before the gesture (default: now). */
		readonly loadsBefore?: number;
	} = {},
): Promise<ActOutcome> {
	const loadsBefore = options.loadsBefore ?? context.navigation.loadCount();
	const dialog = await raceDialogs(
		context.dialogs,
		async () => {
			await gesture();
			await waitForFramesLoaded(context.page, context.navigation, action.timeoutMs);
		},
		options.onDialog,
	);
	return buildOutcome(context, action, loadsBefore, { ...options.extras?.(), dialog });
}
