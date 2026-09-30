/** Thrown when a params/outputs list declares the same name twice, so no runtime schema can be built. */
export class DuplicateSpecNameError extends Error {
	readonly code = 'duplicate_spec_name' as const;

	constructor(
		readonly specKind: 'param' | 'output',
		readonly specName: string,
	) {
		super(`Duplicate ${specKind} name "${specName}"`);
		this.name = 'DuplicateSpecNameError';
	}
}
