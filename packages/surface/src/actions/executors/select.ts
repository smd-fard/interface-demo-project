import { OptionNotFoundError } from '../../errors/OptionNotFoundError.js';
import { normalizeText } from '../../internal/normalizeText.js';
import type { ActOutcome } from '../../port/ActOutcome.js';
import type { ActionTarget, SurfaceActionOf } from '../../port/SurfaceAction.js';
import type { ActionContext } from '../ActionContext.js';
import { actAndSettle } from '../actAndSettle.js';

/** One `<option>` of a dropdown. */
export interface SelectOption {
	readonly label: string;
	readonly value: string;
}

/** The option to choose: the first whose label matches (normalized), else the first whose value matches. */
export function pickOption(options: readonly SelectOption[], wanted: string): SelectOption | undefined {
	const label = normalizeText(wanted);
	return options.find((option) => normalizeText(option.label) === label) ?? options.find((o) => o.value === wanted);
}

function describeTarget(target: ActionTarget): string {
	return target.kind === 'target' ? target.target.description : `ref ${target.ref}`;
}

/** Chooses a dropdown option by its label (falling back to its value) and waits for the frames to load. */
export async function executeSelect(context: ActionContext, action: SurfaceActionOf<'select'>): Promise<ActOutcome> {
	const resolved = await context.resolveTarget(action.target, action.bindings ?? {});
	const timeout = action.timeoutMs === undefined ? {} : { timeout: action.timeoutMs };
	const options = await resolved.locator.evaluate((element) =>
		element instanceof HTMLSelectElement
			? Array.from(element.options, (option) => ({ label: option.label, value: option.value }))
			: [],
	);
	const option = pickOption(options, action.option);
	if (option === undefined) throw new OptionNotFoundError(describeTarget(action.target), options.length);
	return actAndSettle(
		context,
		action,
		async () => {
			await resolved.locator.selectOption({ value: option.value }, timeout);
		},
		{ extras: () => (resolved.resolution === undefined ? {} : { resolution: resolved.resolution }) },
	);
}
