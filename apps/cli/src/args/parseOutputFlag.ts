import { OutputSpecSchema, type OutputSpec, type ValueType } from '@idp/artifact-schema';
import { CliUsageError } from '../errors/CliUsageError.js';

const DEFAULT_DECIMAL_SCALE = 2;

function valueType(kind: string, extra: readonly string[], flag: string): ValueType {
	if (kind === 'decimal') {
		if (extra.length > 1) throw new CliUsageError(`--output ${flag}: decimal takes one scale, e.g. name:decimal:2`);
		const scale = extra[0] === undefined ? DEFAULT_DECIMAL_SCALE : Number(extra[0]);
		if (!Number.isInteger(scale) || scale < 0)
			throw new CliUsageError(`--output ${flag}: the scale must be an integer`);
		return { kind: 'decimal', scale };
	}
	if (extra.length > 0) throw new CliUsageError(`--output ${flag}: only decimal takes a scale`);
	switch (kind) {
		case 'string':
		case 'integer':
		case 'boolean':
			return { kind };
		default:
			throw new CliUsageError(`--output ${flag}: the type must be string, integer, decimal[:scale] or boolean`);
	}
}

/**
 * Parses `--output name:type` (type `string | integer | boolean | decimal[:scale]`, scale default 2) into an
 * output spec. CLI-declared outputs are always sensitive (masked in every sink); edit the artifact to relax it.
 */
export function parseOutputFlag(flag: string): OutputSpec {
	const [name = '', kind, ...extra] = flag.split(':');
	if (kind === undefined) throw new CliUsageError(`--output expects name:type, e.g. savingsBalance:decimal:2`);
	const parsed = OutputSpecSchema.safeParse({
		name,
		description: `The ${name} value read from the screen (declared with --output).`,
		type: valueType(kind, extra, flag),
		sensitive: true,
	});
	if (!parsed.success) throw new CliUsageError(`--output ${flag}: the name must be a camelCase identifier`);
	return parsed.data;
}
