import { DialogPendingError } from '../../errors/DialogPendingError.js';
import { normalizeText } from '../../internal/normalizeText.js';
import type { ActOutcome } from '../../port/ActOutcome.js';
import type { SurfaceActionOf } from '../../port/SurfaceAction.js';
import type { ActionContext } from '../ActionContext.js';
import { buildOutcome } from '../actAndSettle.js';
import { raceDialogs } from '../raceDialogs.js';

/**
 * Reads the target's text (`innerText`; an input's, textarea's or select's value), whitespace-normalized. The
 * raw string is returned as is: parsing to a number is the replay engine's job. Sensitive: never logged here.
 */
export async function executeExtract(context: ActionContext, action: SurfaceActionOf<'extract'>): Promise<ActOutcome> {
	const loadsBefore = context.navigation.loadCount();
	const resolved = await context.resolveTarget(action.target, action.bindings ?? {});
	let raw = '';
	const dialog = await raceDialogs(context.dialogs, async () => {
		raw = await resolved.locator.evaluate(
			(element) =>
				element instanceof HTMLInputElement ||
				element instanceof HTMLTextAreaElement ||
				element instanceof HTMLSelectElement
					? element.value
					: element instanceof HTMLElement
						? element.innerText
						: (element.textContent ?? ''),
			undefined,
			action.timeoutMs === undefined ? {} : { timeout: action.timeoutMs },
		);
	});
	if (dialog !== null) throw new DialogPendingError(action.kind, dialog.type);
	return buildOutcome(context, action, loadsBefore, {
		extracted: normalizeText(raw),
		...(resolved.resolution === undefined ? {} : { resolution: resolved.resolution }),
	});
}
