import type { StepOf } from '@idp/artifact-schema';
import { OutputParseError } from '../../outputs/OutputParseError.js';
import { parseExtracted } from '../../outputs/extractOutputs.js';
import { actionBase, performAction } from '../performAction.js';
import type { StepContext, StepPosition } from '../StepContext.js';
import type { StepOutcome } from '../StepOutcome.js';
import { verifyCheckpoint } from '../verifyCheckpoint.js';

/**
 * Reads the target's text into the step's output. When the output is sensitive (the default), the raw text and
 * its parsed form are added to the redactor at once, before anything is logged. Parsing and type validation of
 * the outputs happen after the success condition (`extractOutputs`).
 */
export async function runExtract(
	step: StepOf<'extract'>,
	position: StepPosition,
	context: StepContext,
): Promise<StepOutcome> {
	const spec = context.outputs.get(step.output);
	const { outcome } = await performAction(
		step,
		position,
		{ kind: 'extract', ...actionBase(step, context), target: { kind: 'target', target: step.target } },
		context,
	);
	const raw = outcome.extracted ?? '';
	if (spec?.sensitive !== false) {
		context.redactor.addSensitiveValue(raw);
		if (spec !== undefined) {
			try {
				context.redactor.addSensitiveValue(String(parseExtracted(raw, step.parse, spec.type)));
			} catch (error) {
				// Unparseable text is reported as output_invalid by extractOutputs; the raw text is already masked.
				if (!(error instanceof OutputParseError)) throw error;
			}
		}
	}
	context.state.extractions.set(step.output, { raw, parse: step.parse, stepIndex: position.index, stepId: step.id });
	return verifyCheckpoint(step.checkpoint, position, context);
}
