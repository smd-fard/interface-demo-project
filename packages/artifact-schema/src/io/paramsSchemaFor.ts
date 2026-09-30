import { z } from 'zod';
import { DuplicateSpecNameError } from './DuplicateSpecNameError.js';
import type { ParamSpec } from './ParamSpec.js';
import { valueSchemaFor, type ScalarValue } from './valueSchemaFor.js';

/** Validated params keyed by name. Optional params that were not supplied are absent. */
export type ParamValues = Readonly<Record<string, ScalarValue>>;

/**
 * A strict runtime schema for a capability's params. Unknown keys are rejected. Integer and boolean params
 * are coerced from strings (CLI input); decimals stay strings.
 * @throws DuplicateSpecNameError when two specs share a name.
 */
export function paramsSchemaFor(specs: readonly ParamSpec[]): z.ZodType<ParamValues> {
	const shape: Record<string, z.ZodType<ScalarValue | undefined>> = {};
	for (const spec of specs) {
		if (Object.hasOwn(shape, spec.name)) throw new DuplicateSpecNameError('param', spec.name);
		const value = valueSchemaFor(spec.type, { coerce: true });
		shape[spec.name] = spec.required ? value : value.optional();
	}
	return z.strictObject(shape) as z.ZodType<ParamValues>;
}
