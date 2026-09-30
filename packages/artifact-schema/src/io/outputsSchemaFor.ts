import { z } from 'zod';
import { DuplicateSpecNameError } from './DuplicateSpecNameError.js';
import type { OutputSpec } from './OutputSpec.js';
import { valueSchemaFor, type ScalarValue } from './valueSchemaFor.js';

/** Outputs keyed by name. Every declared output is present on success. */
export type OutputValues = Readonly<Record<string, ScalarValue>>;

/**
 * A strict runtime schema for a capability's success outputs: every output required, no coercion, no extra keys.
 * @throws DuplicateSpecNameError when two specs share a name.
 */
export function outputsSchemaFor(specs: readonly OutputSpec[]): z.ZodType<OutputValues> {
	const shape: Record<string, z.ZodType<ScalarValue>> = {};
	for (const spec of specs) {
		if (Object.hasOwn(shape, spec.name)) throw new DuplicateSpecNameError('output', spec.name);
		shape[spec.name] = valueSchemaFor(spec.type, { coerce: false });
	}
	return z.strictObject(shape);
}
