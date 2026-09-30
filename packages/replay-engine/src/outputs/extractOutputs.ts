import {
	outputsSchemaFor,
	type OutputSpec,
	type OutputValues,
	type ScalarValue,
	type StepOf,
	type ValueType,
} from '@idp/artifact-schema';
import { ReplayError } from '../errors/ReplayError.js';
import { OutputParseError } from './OutputParseError.js';

/** How an extract step turns element text into a value. */
export type ExtractParse = StepOf<'extract'>['parse'];

/** The raw text an extract step read, kept until the outputs are validated after the success condition. */
export interface RawExtraction {
	/** Whitespace-normalized element text. Sensitive when the output is: already added to the redactor. */
	readonly raw: string;
	readonly parse: ExtractParse;
	readonly stepIndex: number;
	readonly stepId: string;
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

function applyPattern(text: string, parse: ExtractParse): string {
	if (parse.pattern === undefined) return text;
	const match = new RegExp(parse.pattern).exec(text);
	if (match === null) throw new OutputParseError(parse.kind, 'the pattern did not match');
	return match[1] ?? match[0];
}

function parseDecimal(text: string, type: ValueType): string {
	let body = text.trim();
	let negative = false;
	if (/^\(.*\)$/.test(body)) {
		negative = true;
		body = body.slice(1, -1);
	}
	if (/-\s*$/.test(body)) {
		negative = true;
		body = body.replace(/-\s*$/, '');
	}
	if (/^[^\d-]*-/.test(body)) {
		negative = true;
		body = body.replace('-', '');
	}
	if (body.includes('-')) throw new OutputParseError('decimal', 'a stray minus sign');
	// Currency symbols, codes, thousands separators and spaces go; digits and the decimal point stay.
	const digits = body.replace(/[^\d.]/g, '');
	const match = /^(\d+)(?:\.(\d+))?$/.exec(digits);
	if (match === null) throw new OutputParseError('decimal', 'no single decimal number found');
	const whole = match[1] ?? '0';
	let fraction = match[2] ?? '';
	if (type.kind === 'decimal' && fraction.length < type.scale) fraction = fraction.padEnd(type.scale, '0');
	const value = fraction === '' ? whole : `${whole}.${fraction}`;
	return negative && /[1-9]/.test(value) ? `-${value}` : value;
}

function parseInteger(text: string): number {
	const digits = text.replace(/[\s,]/g, '');
	if (!/^-?\d+$/.test(digits)) throw new OutputParseError('integer', 'not a whole number');
	const value = Number(digits);
	if (!Number.isSafeInteger(value)) throw new OutputParseError('integer', 'outside the safe integer range');
	return value;
}

/**
 * Parses extracted element text per the step's `parse`: the pattern (first capture group, or the whole match)
 * first, then `text` (normalized), `decimal` (an exact decimal string, padded to the declared scale, e.g.
 * "1,523.4" → "1523.40"; never a float) or `integer`. Throws `OutputParseError`.
 */
export function parseExtracted(raw: string, parse: ExtractParse, type: ValueType): ScalarValue {
	const text = normalize(applyPattern(normalize(raw), parse));
	switch (parse.kind) {
		case 'text':
			return text;
		case 'decimal':
			return parseDecimal(text, type);
		case 'integer':
			return parseInteger(text);
	}
}

/**
 * Parses every extraction and validates the outputs with `outputsSchemaFor` (every declared output present,
 * typed, no extras). A problem is a `ReplayError` `output_invalid` at the output's extract step (or `null`
 * when the output was never extracted); `observed` holds the raw text, redacted when the result is built.
 */
export function extractOutputs(
	extractions: ReadonlyMap<string, RawExtraction>,
	specs: readonly OutputSpec[],
): OutputValues {
	const values: Record<string, ScalarValue> = {};
	for (const spec of specs) {
		const extraction = extractions.get(spec.name);
		if (extraction === undefined) {
			throw new ReplayError('output_invalid', {
				step: null,
				expected: `output "${spec.name}" (${spec.type.kind})`,
				observed: 'it was never extracted',
			});
		}
		const step = { index: extraction.stepIndex, id: extraction.stepId };
		try {
			values[spec.name] = parseExtracted(extraction.raw, extraction.parse, spec.type);
		} catch (error) {
			if (!(error instanceof OutputParseError)) throw error;
			throw new ReplayError('output_invalid', {
				step,
				expected: `output "${spec.name}" as ${spec.type.kind}`,
				observed: `"${extraction.raw}": ${error.problem}`,
				cause: error,
			});
		}
	}
	const validated = outputsSchemaFor(specs).safeParse(values);
	if (validated.success) return validated.data;
	const issue = validated.error.issues[0];
	const name = String(issue?.path[0] ?? '');
	const extraction = extractions.get(name);
	throw new ReplayError('output_invalid', {
		step: extraction === undefined ? null : { index: extraction.stepIndex, id: extraction.stepId },
		expected: `output "${name}" to match its declared type`,
		observed: `"${String(values[name] ?? '')}": ${issue?.message ?? 'invalid'}`,
	});
}
